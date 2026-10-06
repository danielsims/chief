import type {
  ChannelActorIdentity,
  ChannelAgentPermission,
  ChannelKind,
  ChannelLifecycleState,
  ChannelWorkstream,
} from "@chief/channel-api";

import type { GuestAppearance } from "./agent-message-types.js";
import type { ExecutorCapability } from "./types.js";

export interface WorkspaceChannel {
  protocol: "nip29";
  id: string;
  slug: string;
  name: string;
  topic: string;
  description: string;
  agentIds: string[];
  userIds: string[];
  visibility?: "public" | "private" | "direct";
  /** Set on a person-to-person DM: the other participant's user id. */
  directUserId?: string;
  kind: ChannelKind;
  lifecycle: ChannelLifecycleState;
  archivedAt?: number;
  createdBy: ChannelActorIdentity;
  agentPermissions: ChannelAgentPermission[];
  workstream?: ChannelWorkstream;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChannelActor {
  /** `guest` is an outside agent admitted to one external channel. */
  type: "user" | "agent" | "guest";
  id: string;
  name: string;
  image?: string;
  /** Present for guests only. */
  guest?: GuestAppearance;
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

/** A Buzz-compatible edit overlay targeting a kind:9 channel message. */
export interface ChannelMessageEditEvent extends ChannelEventBase {
  kind: 40003;
}

/** A NIP-09 tombstone targeting a message, edit, or reaction event. */
export interface ChannelDeletionEvent extends ChannelEventBase {
  kind: 5;
}

export type ChannelEvent =
  | ChannelMessageEvent
  | ChannelReactionEvent
  | ChannelMessageEditEvent
  | ChannelDeletionEvent;

export type ChannelClientMessage =
  | {
      type: "listChannels";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "setChannelPolicy";
      requestId: string;
      workspaceId: string;
      channelId: string;
      agentPermissions: ChannelAgentPermission[];
      sessionToken: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "setChannelArchived";
      requestId: string;
      workspaceId: string;
      channelId: string;
      archived: boolean;
      sessionToken: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listChannelEvents";
      workspaceId: string;
      channelId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      /** Tells the other people in a channel that this user is typing. */
      type: "typing";
      workspaceId: string;
      channelId: string;
      active: boolean;
    }
  | {
      /** Opens (or reuses) a person-to-person DM with a workspace member. */
      type: "startUserDirect";
      requestId: string;
      workspaceId: string;
      userId: string;
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
      type: "updateChannel";
      requestId: string;
      workspaceId: string;
      channelId: string;
      name: string;
      topic: string;
      description: string;
      /** Relay channels only; local channels ignore it. */
      visibility?: "public" | "private";
      sessionToken: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "deleteChannel";
      requestId: string;
      workspaceId: string;
      channelId: string;
      sessionToken: string;
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
      /** Another person is typing in a channel. Expires on the client. */
      type: "userTyping";
      workspaceId: string;
      channelId: string;
      userId: string;
      active: boolean;
    }
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
      type: "channelPolicyUpdated";
      requestId: string;
      workspaceId: string;
      channel: WorkspaceChannel;
    }
  | {
      type: "channelPolicyUpdateFailed";
      requestId: string;
      workspaceId: string;
      channelId: string;
      message: string;
    }
  | {
      type: "channelUpdated";
      requestId: string;
      workspaceId: string;
      channel: WorkspaceChannel;
    }
  | {
      type: "channelUpdateFailed";
      requestId: string;
      workspaceId: string;
      channelId: string;
      message: string;
    }
  | {
      type: "channelDeleted";
      requestId: string;
      workspaceId: string;
      channelId: string;
    }
  | {
      type: "channelDeleteFailed";
      requestId: string;
      workspaceId: string;
      channelId: string;
      message: string;
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
