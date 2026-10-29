import { PROVIDERS, type ProviderKey } from "../../contracts/src/v1.ts";
import type { NormalizedChatMessage, NormalizedProviderEvent, ProviderEventKind, ProviderHealthSnapshot, ViewerAggregate } from "../../contracts/src/chat-v1.ts";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Rec : null;
const child = (v: Rec | null, k: string): Rec | null => rec(v?.[k]);
const id = (v: unknown): string => typeof v === "string" ? v.trim().slice(0, 128) : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
const text = (v: unknown, max: number): string => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const date = (v: unknown, fallback: Date): string => {
  if (typeof v === "string" || typeof v === "number") {
    const normalized = typeof v === "number" && Math.abs(v) < 1_000_000_000_000 ? v * 1000 : v;
    const parsed = new Date(normalized);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
};
function normalize(input: {
  provider: ProviderKey; externalMessageId: unknown; channelId: unknown; channelName: unknown;
  senderId: unknown; senderName: unknown; body: unknown; sentAt: unknown; receivedAt: Date;
  moderator?: unknown; subscriber?: unknown; verified?: unknown; badges?: unknown;
}): NormalizedChatMessage | null {
  const externalMessageId = id(input.externalMessageId), channelId = id(input.channelId);
  const senderId = id(input.senderId), senderName = text(input.senderName, 80), body = text(input.body, 500);
  if (!externalMessageId || !channelId || !senderId || !senderName || !body) return null;
  const badgeList = Array.isArray(input.badges) ? input.badges.map(rec).filter(Boolean) as Rec[] : [];
  const badgeNames = badgeList.map(b => text(b.type ?? b.set_id ?? b.name, 40).toLowerCase());
  return {
    id: input.provider + ":" + externalMessageId, provider: input.provider, externalMessageId, channelId,
    channelName: text(input.channelName, 80) || channelId, senderId, senderName, text: body,
    sentAt: date(input.sentAt, input.receivedAt), receivedAt: input.receivedAt.toISOString(),
    badges: {
      moderator: input.moderator === true || badgeNames.some(b => b.includes("moderator") || b === "mod"),
      subscriber: input.subscriber === true || badgeNames.some(b => b.includes("subscriber") || b.includes("sub_gifter")),
      verified: input.verified === true || badgeNames.some(b => b.includes("verified")),
    },
  };
}

export function normalizeTwitchChatMessage(payload: unknown, receivedAt = new Date()): NormalizedChatMessage | null {
  const root = rec(payload), event = child(root, "event") ?? root, message = child(event, "message");
  if (!event || !message) return null;
  return normalize({
    provider: "twitch", externalMessageId: event.message_id, channelId: event.broadcaster_user_id,
    channelName: event.broadcaster_user_name, senderId: event.chatter_user_id, senderName: event.chatter_user_name,
    body: message.text, sentAt: event.sent_at, receivedAt, badges: event.badges,
  });
}

export function normalizeYouTubeChatMessage(payload: unknown, channelName = "", receivedAt = new Date()): NormalizedChatMessage | null {
  const root = rec(payload), snippet = child(root, "snippet"), author = child(root, "authorDetails");
  if (!root || !snippet || !author) return null;
  return normalize({
    provider: "youtube", externalMessageId: root.id, channelId: snippet.liveChatId,
    channelName: channelName || snippet.liveChatId, senderId: author.channelId, senderName: author.displayName,
    body: snippet.displayMessage ?? child(snippet, "textMessageDetails")?.messageText, sentAt: snippet.publishedAt,
    receivedAt, moderator: author.isChatModerator, subscriber: author.isChatSponsor, verified: author.isVerified,
  });
}

export function normalizeKickChatMessage(payload: unknown, receivedAt = new Date()): NormalizedChatMessage | null {
  const root = rec(payload), sender = child(root, "sender"), broadcaster = child(root, "broadcaster");
  if (!root || !sender || !broadcaster) return null;
  return normalize({
    provider: "kick", externalMessageId: root.message_id, channelId: broadcaster.user_id,
    channelName: broadcaster.username, senderId: sender.user_id, senderName: sender.username,
    body: root.content, sentAt: root.created_at, receivedAt, verified: sender.is_verified,
    badges: child(sender, "identity")?.badges,
  });
}

export function normalizeTikTokChatMessage(payload: unknown, channelId = "", channelName = "", receivedAt = new Date()): NormalizedChatMessage | null {
  const root = rec(payload), user = child(root, "user") ?? child(root, "userInfo");
  if (!root || !user) return null;
  const room = child(root, "room");
  return normalize({
    provider: "tiktok",
    externalMessageId: root.msgId ?? root.messageId ?? root.commentId ?? root.id,
    channelId: channelId || root.roomId || root.room_id || room?.id,
    channelName: channelName || text(root.roomName ?? room?.title, 80),
    senderId: user.userId ?? user.user_id ?? user.id,
    senderName: user.uniqueId ?? user.nickname ?? user.displayId ?? user.username,
    body: root.comment ?? root.text ?? root.content,
    sentAt: root.createTime ?? root.create_time ?? root.timestamp,
    receivedAt, moderator: root.isModerator ?? user.isModerator,
    subscriber: root.isSubscriber ?? user.isSubscriber, verified: user.isVerified,
  });
}

const TIKTOK_EVENT_KIND: Record<string, ProviderEventKind> = {
  follow: "follow", follow_event: "follow", subscribe: "subscription", subscription: "subscription",
  gift: "gift", gift_event: "gift", like: "like", like_event: "like", share: "share",
  share_event: "share", member: "member_join", member_join: "member_join", roomuser: "viewer_count",
  room_user: "viewer_count", viewer_count: "viewer_count",
};

/** Normalize the unofficial TikTok LIVE connector's event callbacks without treating gifts as cash donations. */
export function normalizeTikTokProviderEvent(
  eventName: string, payload: unknown, channelId: string, channelName = "", receivedAt = new Date(),
): NormalizedProviderEvent | null {
  const root = rec(payload);
  const user = child(root, "user") ?? child(root, "gifter") ?? child(root, "userInfo");
  const kind = TIKTOK_EVENT_KIND[eventName.toLowerCase()];
  if (!root || !kind || !id(channelId)) return null;
  const eventId = id(root.eventId ?? root.event_id ?? root.msgId ?? root.messageId ?? root.id
    ?? (root.createTime !== undefined ? eventName + ":" + id(root.createTime) + ":" + id(user?.userId ?? user?.id)
      : kind === "viewer_count" ? eventName + ":" + id(root.totalUserCount ?? root.viewerCount) + ":" + receivedAt.getTime() : ""));
  if (!eventId) return null;
  const gift = child(root, "gift") ?? child(root, "giftDetails") ?? child(root, "extendedGiftInfo");
  const amountValue = root.amount ?? root.superChatAmount ?? root.bits;
  const amount = typeof amountValue === "number" && Number.isFinite(amountValue) && amountValue >= 0 ? amountValue : null;
  const quantityValue = root.repeatCount ?? root.repeat_count ?? root.count ?? root.likeCount ?? root.totalUserCount ?? root.viewerCount;
  const quantity = typeof quantityValue === "number" && Number.isSafeInteger(quantityValue) && quantityValue >= 0 ? quantityValue : null;
  return {
    id: "tiktok:" + eventId, provider: "tiktok", externalEventId: eventId, kind,
    channelId: id(channelId), channelName: text(channelName, 80) || id(channelId),
    actorId: id(user?.userId ?? user?.user_id ?? user?.id) || null,
    actorName: text(user?.uniqueId ?? user?.nickname ?? user?.displayId ?? user?.username, 80) || null,
    message: text(root.comment ?? root.message ?? root.text, 500) || null,
    itemName: text(gift?.name ?? root.giftName ?? root.gift_name, 100) || null,
    quantity, amount, currency: text(root.currency, 8) || null,
    occurredAt: date(root.createTime ?? root.create_time ?? root.timestamp, receivedAt),
    receivedAt: receivedAt.toISOString(),
  };
}

export class ChatMessageDeduplicator {
  private readonly seen = new Map<string, number>();
  constructor(privateTtlMs = 600_000, privateMaxEntries = 5000) {
    if (!Number.isFinite(privateTtlMs) || privateTtlMs < 1 || !Number.isInteger(privateMaxEntries) || privateMaxEntries < 1) throw new Error("Invalid dedupe bounds");
    this.ttlMs = privateTtlMs; this.maxEntries = privateMaxEntries;
  }
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  accept(message: Pick<NormalizedChatMessage, "provider" | "externalMessageId">, nowMs = Date.now()): boolean {
    for (const [key, seenAt] of this.seen) if (nowMs - seenAt >= this.ttlMs) this.seen.delete(key);
    const key = message.provider + ":" + message.externalMessageId;
    if (this.seen.has(key)) return false;
    this.seen.set(key, nowMs);
    while (this.seen.size > this.maxEntries) this.seen.delete(this.seen.keys().next().value!);
    return true;
  }
  get size(): number { return this.seen.size; }
}

export function reconnectDelayMs(attempt: number, random = Math.random, baseMs = 1000, capMs = 60_000): number {
  const n = Math.max(0, Math.min(30, Math.floor(Number.isFinite(attempt) ? attempt : 0)));
  return Math.floor(Math.max(0, Math.min(1, random())) * Math.min(capMs, baseMs * (2 ** n)));
}

export function emptyProviderHealth(provider: ProviderKey, observedAt = new Date()): ProviderHealthSnapshot {
  return { provider, state: "disconnected", observedAt: observedAt.toISOString(),
    lastMessageAt: null, viewerCount: null, viewerCountObservedAt: null,
    detailCode: provider === "tiktok" ? "unofficial_connector_not_configured" : "not_connected", unofficial: provider === "tiktok" };
}

export function aggregateViewerCounts(snapshots: readonly ProviderHealthSnapshot[], now = new Date(), maxAgeMs = 90_000): ViewerAggregate {
  const map = new Map(snapshots.map(s => [s.provider, s]));
  const includedProviders: ProviderKey[] = [], missingProviders: ProviderKey[] = [];
  let total = 0;
  for (const provider of PROVIDERS) {
    const s = map.get(provider), at = s?.viewerCountObservedAt ? Date.parse(s.viewerCountObservedAt) : NaN;
    const fresh = Number.isFinite(at) && now.getTime() >= at && now.getTime() - at <= maxAgeMs;
    if (s && (s.state === "connected" || s.state === "degraded") && fresh && Number.isSafeInteger(s.viewerCount) && (s.viewerCount ?? -1) >= 0) {
      includedProviders.push(provider); total += s.viewerCount!;
    } else missingProviders.push(provider);
  }
  return { total: includedProviders.length ? total : null, includedProviders, missingProviders, partial: includedProviders.length > 0 && missingProviders.length > 0 };
}
