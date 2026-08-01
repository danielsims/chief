import type { ExecutorCapability } from "./types.js";

export interface WorkspaceChannel {
  protocol: "nip29";
  id: string;
  slug: string;
  name: string;
  description: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ChannelActor {
  type: "user" | "agent";
  id: string;
  name: string;
}

/** A NIP-29 kind:9 event scoped to a channel by its `h` tag. */
export interface ChannelEvent {
  protocol: "nip29";
  id: string;
  channelId: string;
  kind: 9;
  pubkey: string;
  tags: string[][];
  content: string;
  parts?: unknown[];
  actor: ChannelActor;
  createdAt: number;
}

export type ChannelClientMessage =
  | {
      type: "listChannels";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listChannelEvents";
      workspaceId: string;
      channelId: string;
      executorCapability: ExecutorCapability;
    };

export type ChannelServerMessage =
  | {
      type: "channels";
      workspaceId: string;
      channels: WorkspaceChannel[];
    }
  | {
      type: "channelEvents";
      workspaceId: string;
      channelId: string;
      events: ChannelEvent[];
    }
  | {
      type: "channelEvent";
      workspaceId: string;
      event: ChannelEvent;
    };
