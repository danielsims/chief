import type { ChannelActorIdentity } from "@chief/channel-api";
import type { JsonObject } from "@chief/relay-contracts";

import type { ChannelEvent, WorkspaceChannel } from "./channel-types.js";
import type { ChannelStore } from "./channels/store.js";
import type { PluginLocalToolService } from "./tools/toolkits/plugins/context.js";
import {
  booleanQuery,
  ChannelApiFailure,
  expectedVersion,
  fail,
  optionalText,
  textValue,
  workstreamInput,
} from "./channel-local-tool-input.js";
import {
  emitMemberAddedEvent,
  requestedMembers,
} from "./channel-membership-local-tools.js";
import { handleChannelMessageLocalTool } from "./channel-message-local-tools.js";
import { ensureChannelPermission } from "./channel-permissions.js";

export interface ChannelLocalToolContext {
  actor: ChannelActorIdentity;
  channelStore: ChannelStore;
  availableAgentIds: readonly string[];
  plugins?: Pick<PluginLocalToolService, "list">;
  onChannelsChanged?: () => void | Promise<void>;
  onChannelEvent?: (event: ChannelEvent) => void | Promise<void>;
  onAgentMentions?: (
    channel: WorkspaceChannel,
    event: ChannelEvent,
    agentIds: readonly string[],
  ) => void | Promise<void>;
  beforeMessagePost?: (input: {
    channel: WorkspaceChannel;
    content: string;
    idempotencyKey?: string;
  }) => void | Promise<void>;
  requestDeletion?: (
    channel: WorkspaceChannel,
    reason: string,
    actor: ChannelActorIdentity,
  ) => Promise<DeletionReview>;
}

interface DeletionReview {
  id: string;
}

interface ChannelToolResult {
  handled: boolean;
  value?: unknown;
  status?: number;
}

function parseChannelPath(path: string) {
  const match = /^\/local-tools\/channels\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (!match?.[1]) return null;
  return {
    channelId: decodeURIComponent(match[1]),
    tail: match[2] ?? "",
  };
}

function ensureActive(channel: WorkspaceChannel) {
  if (channel.lifecycle === "archived") {
    fail(
      `#${channel.name} is archived. Restore it before continuing work.`,
      409,
      "channel_archived",
    );
  }
}

async function visibleChannel(
  context: ChannelLocalToolContext,
  workspaceId: string,
  channelId: string,
) {
  const channel = await context.channelStore.get(workspaceId, channelId);
  if (!channel || channel.visibility === "direct") {
    fail("Channel was not found in this workspace.", 404, "channel_not_found");
  }
  if (
    context.actor.type === "agent" &&
    channel.visibility === "private" &&
    !channel.agentIds.includes(context.actor.id)
  ) {
    fail("Channel was not found in this workspace.", 404, "channel_not_found");
  }
  return channel;
}

export async function handleChannelLocalTool(
  request: Request,
  workspaceId: string,
  body: JsonObject,
  context: ChannelLocalToolContext | undefined,
): Promise<ChannelToolResult> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (
    !path.startsWith("/local-tools/channels") &&
    path !== "/local-tools/messages/search"
  ) {
    return { handled: false };
  }
  if (!context) {
    return {
      handled: true,
      status: 503,
      value: {
        error: "Channel management is unavailable.",
        code: "channel_api_unavailable",
      },
    };
  }

  try {
    if (path === "/local-tools/messages/search") {
      return handleChannelMessageLocalTool({
        request,
        workspaceId,
        body,
        context,
      });
    }
    if (path === "/local-tools/channels" && request.method === "GET") {
      const includeArchived = booleanQuery(url, "includeArchived");
      const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
      const channels = (await context.channelStore.list(workspaceId)).filter(
        (channel) =>
          channel.visibility !== "direct" &&
          (includeArchived || channel.lifecycle === "active") &&
          (context.actor.type !== "agent" ||
            channel.visibility === "public" ||
            channel.agentIds.includes(context.actor.id)) &&
          (!query ||
            `${channel.name} ${channel.slug} ${channel.description}`
              .toLowerCase()
              .includes(query)),
      );
      return { handled: true, value: { channels } };
    }

    if (path === "/local-tools/channels" && request.method === "POST") {
      const operationKey = textValue(body.operationKey, "operationKey", 80);
      if (!/^[a-z0-9][a-z0-9-]{5,79}$/.test(operationKey)) {
        fail(
          "operationKey must be a stable lowercase slug.",
          400,
          "invalid_operation_key",
        );
      }
      const kind = body.kind === "feature" ? "feature" : "standard";
      const requested = requestedMembers(
        body,
        context.availableAgentIds,
        false,
      );
      const agentIds = [
        ...new Set([
          ...(context.actor.type === "agent" ? [context.actor.id] : []),
          ...requested.agentIds,
        ]),
      ];
      const visibility = body.visibility === "private" ? "private" : "public";
      const channel = await context.channelStore.create(workspaceId, {
        name: textValue(body.name, "name", 60),
        description: optionalText(body.description, "description", 160),
        topic: optionalText(body.topic, "topic", 250),
        visibility,
        kind,
        actor: context.actor,
        agentIds,
        agentPermissions: [
          "update_metadata",
          "manage_members",
          "manage_workstream",
          "archive",
        ],
        workstream:
          kind === "feature"
            ? workstreamInput(body.workstream, {
                status: "planned",
                pullRequestUrls: [],
              })
            : undefined,
        operationKey,
        strictName: true,
      });
      await context.onChannelsChanged?.();
      await emitMemberAddedEvent({
        context,
        workspaceId,
        channel,
        agentIds: requested.agentIds.filter(
          (agentId) => agentId !== context.actor.id,
        ),
        userIds: requested.userIds,
        sourceId: `channel-api:${operationKey}:members`,
      });
      return { handled: true, value: { channel } };
    }

    const parsed = parseChannelPath(path);
    if (!parsed) return { handled: false };
    const storedChannel = await context.channelStore.get(
      workspaceId,
      parsed.channelId,
    );
    if (storedChannel?.visibility === "direct") {
      const directMessageResult = await handleChannelMessageLocalTool({
        request,
        workspaceId,
        body,
        context,
        channel: storedChannel,
        tail: parsed.tail,
      });
      if (directMessageResult.handled) return directMessageResult;
      fail(
        "Channel was not found in this workspace.",
        404,
        "channel_not_found",
      );
    }
    const channel = await visibleChannel(
      context,
      workspaceId,
      parsed.channelId,
    );

    const messageResult = await handleChannelMessageLocalTool({
      request,
      workspaceId,
      body,
      context,
      channel,
      tail: parsed.tail,
    });
    if (messageResult.handled) return messageResult;

    if (!parsed.tail && request.method === "GET") {
      return { handled: true, value: { channel } };
    }
    if (!parsed.tail && request.method === "PATCH") {
      if (body.workstream !== undefined) {
        ensureChannelPermission(channel, context.actor, "manage_workstream");
      }
      if (
        body.name !== undefined ||
        body.topic !== undefined ||
        body.description !== undefined
      ) {
        ensureChannelPermission(channel, context.actor, "update_metadata");
      }
      const updated = await context.channelStore.update(
        workspaceId,
        channel.id,
        {
          name: optionalText(body.name, "name", 60),
          topic: optionalText(body.topic, "topic", 250),
          description: optionalText(body.description, "description", 160),
          workstream: workstreamInput(body.workstream, channel.workstream),
          expectedVersion: expectedVersion(body),
          actor: context.actor,
        },
      );
      await context.onChannelsChanged?.();
      return { handled: true, value: { channel: updated } };
    }
    if (parsed.tail === "archive" && request.method === "POST") {
      ensureChannelPermission(channel, context.actor, "archive");
      const updated = await context.channelStore.setArchived(
        workspaceId,
        channel.id,
        true,
        { expectedVersion: expectedVersion(body), actor: context.actor },
      );
      await context.onChannelsChanged?.();
      return { handled: true, value: { channel: updated } };
    }
    if (parsed.tail === "unarchive" && request.method === "POST") {
      ensureChannelPermission(channel, context.actor, "archive");
      const updated = await context.channelStore.setArchived(
        workspaceId,
        channel.id,
        false,
        { expectedVersion: expectedVersion(body), actor: context.actor },
      );
      await context.onChannelsChanged?.();
      return { handled: true, value: { channel: updated } };
    }
    if (parsed.tail === "join" && request.method === "POST") {
      ensureActive(channel);
      if (context.actor.type !== "agent") {
        fail("Only agents join through this operation.", 400, "invalid_actor");
      }
      if (channel.visibility !== "public") {
        fail(
          "Private channels require an invitation.",
          403,
          "invitation_required",
        );
      }
      const updated = await context.channelStore.addAgents(
        workspaceId,
        channel.id,
        [context.actor.id],
        expectedVersion(body),
      );
      await context.channelStore.audit(
        workspaceId,
        channel.id,
        "member.joined",
        context.actor,
        { agentId: context.actor.id },
      );
      await context.onChannelsChanged?.();
      return { handled: true, value: { channel: updated } };
    }
    if (parsed.tail === "leave" && request.method === "POST") {
      if (context.actor.type !== "agent") {
        fail("Only agents leave through this operation.", 400, "invalid_actor");
      }
      if (!channel.agentIds.includes(context.actor.id)) {
        fail("The calling agent is not in this channel.", 409, "not_a_member");
      }
      const updated = await context.channelStore.removeAgent(
        workspaceId,
        channel.id,
        context.actor.id,
        expectedVersion(body),
      );
      await context.channelStore.audit(
        workspaceId,
        channel.id,
        "member.left",
        context.actor,
        { agentId: context.actor.id },
      );
      await context.onChannelsChanged?.();
      return { handled: true, value: { channel: updated } };
    }
    if (parsed.tail === "members" && request.method === "GET") {
      return {
        handled: true,
        value: {
          members: [
            ...channel.userIds.map((userId) => ({
              id: userId,
              type: "user",
              role: userId === "workspace-owner" ? "owner" : "member",
            })),
            ...channel.agentIds.map((agentId) => ({
              id: agentId,
              type: "agent",
              role: "member",
            })),
          ],
        },
      };
    }
    if (parsed.tail === "members" && request.method === "POST") {
      ensureChannelPermission(channel, context.actor, "manage_members");
      ensureActive(channel);
      const requested = requestedMembers(body, context.availableAgentIds, true);
      const addedAgentIds = requested.agentIds.filter(
        (agentId) => !channel.agentIds.includes(agentId),
      );
      const addedUserIds = requested.userIds.filter(
        (userId) => !channel.userIds.includes(userId),
      );
      const updated = await context.channelStore.addMembers(
        workspaceId,
        channel.id,
        requested.agentIds,
        requested.userIds,
        expectedVersion(body),
      );
      await context.channelStore.audit(
        workspaceId,
        channel.id,
        "member.added",
        context.actor,
        { agentIds: requested.agentIds, userIds: requested.userIds },
      );
      await context.onChannelsChanged?.();
      const idempotencyKey = optionalText(
        body.idempotencyKey,
        "idempotencyKey",
        120,
      );
      await emitMemberAddedEvent({
        context,
        workspaceId,
        channel: updated ?? channel,
        agentIds: addedAgentIds,
        userIds: addedUserIds,
        sourceId: idempotencyKey
          ? `channel-api:${idempotencyKey}:members`
          : undefined,
      });
      return { handled: true, value: { channel: updated } };
    }
    const memberMatch = /^members\/([^/]+)$/.exec(parsed.tail);
    if (memberMatch?.[1] && request.method === "DELETE") {
      ensureChannelPermission(channel, context.actor, "manage_members");
      const agentId = decodeURIComponent(memberMatch[1]);
      if (agentId === "workspace-owner") {
        fail(
          "The workspace owner cannot be removed from a workspace channel.",
          409,
          "owner_membership_required",
        );
      }
      if (!context.availableAgentIds.includes(agentId)) {
        fail("Agent was not found.", 404, "agent_not_found");
      }
      const updated = await context.channelStore.removeAgent(
        workspaceId,
        channel.id,
        agentId,
        expectedVersion(body),
      );
      await context.channelStore.audit(
        workspaceId,
        channel.id,
        "member.removed",
        context.actor,
        { agentId },
      );
      await context.onChannelsChanged?.();
      return { handled: true, value: { channel: updated } };
    }
    if (parsed.tail === "activity" && request.method === "GET") {
      return {
        handled: true,
        value: {
          activity: await context.channelStore.activity(
            workspaceId,
            channel.id,
          ),
        },
      };
    }
    if (parsed.tail === "deletion-request" && request.method === "POST") {
      ensureChannelPermission(channel, context.actor, "archive");
      const reason = textValue(body.reason, "reason", 1_000);
      if (reason.length < 20) {
        fail(
          "Give the owner a concrete deletion reason of at least 20 characters.",
          400,
          "invalid_input",
        );
      }
      if (!context.requestDeletion) {
        fail(
          "Owner deletion review is unavailable.",
          503,
          "deletion_review_unavailable",
        );
      }
      const actionItem = await context.requestDeletion(
        channel,
        reason,
        context.actor,
      );
      await context.channelStore.audit(
        workspaceId,
        channel.id,
        "channel.deletion_requested",
        context.actor,
        { reason },
      );
      return { handled: true, value: { actionItem } };
    }
    return { handled: false };
  } catch (error) {
    if (error instanceof ChannelApiFailure) {
      return {
        handled: true,
        status: error.status,
        value: { error: error.message, code: error.code },
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    const conflict = /version|already exists|changed since/i.test(message);
    return {
      handled: true,
      status: conflict ? 409 : 400,
      value: {
        error: message,
        code: conflict ? "write_conflict" : "channel_operation_failed",
      },
    };
  }
}
