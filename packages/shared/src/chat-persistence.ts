import type { D1Database } from "../../../src/env.ts";
import type { NormalizedChatMessage } from "../../contracts/src/chat-v1.ts";

export async function persistNormalizedChatMessage(db: D1Database, accountId: string, message: NormalizedChatMessage) {
  try {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO chat_messages
       (id, account_id, provider, external_message_id, channel_id, channel_name, sender_id, sender_name, text, sent_at, received_at, badges_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), accountId, message.provider, message.externalMessageId, message.channelId,
      message.channelName, message.senderId, message.senderName, message.text, message.sentAt,
      message.receivedAt, JSON.stringify(message.badges),
    ).run();
    if (!result.success) return { ok: false as const, inserted: false };
    return { ok: true as const, inserted: (result.meta?.changes ?? 0) === 1 };
  } catch {
    return { ok: false as const, inserted: false };
  }
}
