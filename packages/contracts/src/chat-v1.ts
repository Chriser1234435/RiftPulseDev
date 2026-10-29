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
