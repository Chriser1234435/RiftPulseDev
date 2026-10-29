import type { ProviderKey } from "./v1.ts";

export type ProviderConnectionState = "connected" | "disconnected" | "degraded" | "error" | "unsupported";

export interface NormalizedChatMessage {
  id: string;
  provider: ProviderKey;
  externalMessageId: string;
  channelId: string;
  channelName: string;
  senderId: string;
  senderName: string;
  text: string;
  sentAt: string;
  receivedAt: string;
  badges: { moderator: boolean; subscriber: boolean; verified: boolean };
}

export type ProviderEventKind =
  | "follow" | "subscription" | "gift" | "bits" | "super_chat" | "donation"
  | "like" | "share" | "raid" | "member_join" | "viewer_count" | "other";

/** Cross-platform stream event. Monetary fields are reported only when the source provides them. */
export interface NormalizedProviderEvent {
  id: string;
  provider: ProviderKey;
  externalEventId: string;
  kind: ProviderEventKind;
  channelId: string;
  channelName: string;
  actorId: string | null;
  actorName: string | null;
  message: string | null;
  itemName: string | null;
  quantity: number | null;
  amount: number | null;
  currency: string | null;
  occurredAt: string;
  receivedAt: string;
}

export interface ProviderHealthSnapshot {
  provider: ProviderKey;
  state: ProviderConnectionState;
  observedAt: string;
  lastMessageAt: string | null;
  viewerCount: number | null;
  viewerCountObservedAt: string | null;
  detailCode: string | null;
  unofficial: boolean;
}

export interface ViewerAggregate {
  total: number | null;
  includedProviders: ProviderKey[];
  missingProviders: ProviderKey[];
  partial: boolean;
}
