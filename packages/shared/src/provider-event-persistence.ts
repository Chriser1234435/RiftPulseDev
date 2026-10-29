import type { D1Database } from "../../../src/env.ts";
import type { NormalizedProviderEvent } from "../../contracts/src/chat-v1.ts";

export async function persistNormalizedProviderEvent(db: D1Database, accountId: string, event: NormalizedProviderEvent) {
  try {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO provider_events
       (id, account_id, provider, external_event_id, kind, channel_id, channel_name, actor_id, actor_name,
        message, item_name, quantity, amount, currency, occurred_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), accountId, event.provider, event.externalEventId, event.kind,
      event.channelId, event.channelName, event.actorId, event.actorName, event.message, event.itemName,
      event.quantity, event.amount, event.currency, event.occurredAt, event.receivedAt,
    ).run();
    if (!result.success) return { ok: false as const, inserted: false };
    return { ok: true as const, inserted: (result.meta?.changes ?? 0) === 1 };
  } catch {
    return { ok: false as const, inserted: false };
  }
}
