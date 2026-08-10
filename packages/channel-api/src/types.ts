export const channelVisibilities = ["public", "private"] as const;
export type ChannelVisibility = (typeof channelVisibilities)[number];

export const channelKinds = ["standard", "feature"] as const;
export type ChannelKind = (typeof channelKinds)[number];

export const channelLifecycleStates = ["active", "archived"] as const;
export type ChannelLifecycleState = (typeof channelLifecycleStates)[number];

export const channelWorkstreamStatuses = [
  "planned",
  "active",
  "review",
  "complete",
  "cancelled",
] as const;
export type ChannelWorkstreamStatus =
  (typeof channelWorkstreamStatuses)[number];

export const channelAgentPermissions = [
  "update_metadata",
  "manage_members",
  "manage_workstream",
  "archive",
] as const;
export type ChannelAgentPermission = (typeof channelAgentPermissions)[number];

export interface ChannelWorkstream {
  status: ChannelWorkstreamStatus;
  repository?: string;
  baseBranch?: string;
  branch?: string;
  pullRequestUrls: string[];
}

export interface ChannelActorIdentity {
  type: "user" | "agent";
  id: string;
  name: string;
}

export const channelMemberRoles = [
  "owner",
  "admin",
  "member",
  "guest",
] as const;
export type ChannelMemberRole = (typeof channelMemberRoles)[number];

export interface ChannelMemberIdentity extends ChannelActorIdentity {
  role: ChannelMemberRole;
}

export type ChannelAuditAction =
  | "channel.created"
  | "channel.updated"
  | "channel.archived"
  | "channel.unarchived"
  | "channel.deletion_requested"
  | "member.joined"
  | "member.left"
  | "member.added"
  | "member.removed"
  | "message.posted"
  | "message.edited"
  | "message.deleted"
  | "reaction.added"
  | "reaction.removed"
  | "policy.updated";

export interface ChannelAuditEntry {
  id: string;
  channelId: string;
  action: ChannelAuditAction;
  actor: ChannelActorIdentity;
  detail: Record<string, unknown>;
  sequence: number;
  previousHash?: string;
  hash: string;
  createdAt: number;
}

export type ChannelApiPermission =
  | "Workspace member"
  | "Channel member"
  | "Channel management enabled"
  | "Workspace owner"
  | "Schedule management enabled"
  | "Webhook secret";

/**
 * Machine-readable Chief permission enforced for an agent calling this
 * operation. Human-facing `permission` copy is deliberately separate so the
 * docs can explain channel policy and ownership without becoming the runtime
 * authorization source of truth.
 */
export type AgentApiToolPermission =
  | "channels.read"
  | "channels.create"
  | "channels.update"
  | "channels.archive"
  | "members.read"
  | "members.manage"
  | "messages.read"
  | "messages.send"
  | "messages.manage"
  | "schedules.read"
  | "schedules.manage"
  | "schedules.run"
  | "webhooks.manage";

export const scheduledWorkStatuses = [
  "draft",
  "active",
  "paused",
  "needs_approval",
  "error",
] as const;
export type ScheduledWorkStatus = (typeof scheduledWorkStatuses)[number];

export type ScheduledWorkTrigger =
  | { type: "cron"; expression: string; timezone: string }
  | { type: "once"; at: number }
  | { type: "webhook" }
  | { type: "channel_mention"; channelId: string; memberId?: string }
  | {
      type: "channel_message";
      channelId: string;
      contains?: string;
      authorTypes?: ("user" | "agent")[];
    }
  | { type: "reaction_added"; channelId: string; emoji?: string };

export type AgentApiGroup =
  | "Discover"
  | "Lifecycle"
  | "Members"
  | "Messages"
  | "Reactions"
  | "Scheduled work"
  | "Triggers"
  | "Runs"
  | "Agents"
  | "Files"
  | "Governance";

export interface ChannelApiOperation {
  operationId: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  group: AgentApiGroup;
  summary: string;
  description: string;
  permission: ChannelApiPermission;
  toolPermission?: AgentApiToolPermission;
  reversible: boolean;
}
