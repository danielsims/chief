import type { ExecutorCapability } from "./types.js";

export interface WorkspaceChannel {
  protocol: "nip29";
  id: string;
  slug: string;
  name: string;
  description: string;
  agentIds: string[];
  visibility?: "public" | "direct";
  createdAt: number;
  updatedAt: number;
}

export interface ChannelActor {
  type: "user" | "agent";
  id: string;
  name: string;
}

interface ChannelEventBase {
  protocol: "nip29";
  id: string;
  channelId: string;
  pubkey: string;
  tags: string[][];
  content: string;
  actor: ChannelActor;
  createdAt: number;
}

/** A NIP-29 kind:9 message scoped to a channel by its `h` tag. */
export interface ChannelMessageEvent extends ChannelEventBase {
  kind: 9;
  parts?: unknown[];
}

/** A NIP-25 kind:7 reaction targeting a channel message. */
export interface ChannelReactionEvent extends ChannelEventBase {
  kind: 7;
}

export type ChannelEvent = ChannelMessageEvent | ChannelReactionEvent;

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
    }
  | {
      type: "createChannel";
      requestId: string;
      workspaceId: string;
      name: string;
      description?: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "updateChannelAgents";
      workspaceId: string;
      channelId: string;
      agentIds: string[];
      executorCapability: ExecutorCapability;
    }
  | {
      type: "reactToChannelMessage";
      workspaceId: string;
      channelId: string;
      messageId: string;
      reaction: string;
      executorCapability: ExecutorCapability;
    };

export type ChannelServerMessage =
  | {
      type: "channels";
      workspaceId: string;
      channels: WorkspaceChannel[];
    }
  | {
      type: "channelCreated";
      requestId: string;
      workspaceId: string;
      channel: WorkspaceChannel;
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
