import type { Principal } from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  channelActionResultSchema,
  channelMemberAddCommandSchema,
  channelMemberRemoveCommandSchema,
  channelMembersResultSchema,
  commandIdSchema,
  isoDateTimeSchema,
  messageIdSchema,
  principalSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import type { readTrustedContext } from "./internal-context";
import type {
  ChannelMemberRow,
  WorkspaceChannelStore,
} from "./workspace-channel-store";
import { HttpError, json, parseJson } from "./http";
import { withTrustedContext } from "./internal-context";
import {
  firstRow,
  parseChannelId,
  principalKindId,
} from "./workspace-channel-store";
import { defaultWorkspaceAgents } from "./workspace-defaults";

interface ChannelMembershipBatchRow extends Record<string, SqlStorageValue> {
  command_id: string;
  conversation_id: string;
  event_json: string;
  published: number;
}

interface PendingChannelMembershipBatchEvent {
  commandId: string;
  messageId: string;
  actor: Principal;
  targets: { kind: "user" | "agent"; id: string; name: string }[];
  occurredAt: string;
}

export class WorkspaceChannelMembership {
  constructor(private readonly store: WorkspaceChannelStore) {}

  channelsMembersList(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const conversationId = parseChannelId(
      new URL(request.url).searchParams.get("conversationId"),
    );
    this.store.requireChannelVisible(conversationId, context.principal);
    return json(
      channelMembersResultSchema.parse({
        members: this.store.channelMemberRows(conversationId),
      }),
    );
  }

  /** All channel memberships in the workspace, for cheap roster membership UIs. */
  channelsMembershipsList(context: ReturnType<typeof readTrustedContext>) {
    const member = this.store.requirePrincipalMember(context.principal);
    if (member.role !== "owner" && member.role !== "admin") {
      throw new HttpError(
        403,
        "channel_memberships_denied",
        "Only a workspace owner or admin can list all channel memberships.",
      );
    }
    const rows = this.store.storage.sql
      .exec(
        `SELECT conversation_id, principal_kind, principal_id, role, joined_at
         FROM channel_members
         ORDER BY conversation_id, principal_kind, principal_id`,
      )
      .toArray() as ChannelMemberRow[];
    return json({
      memberships: rows.map((row) => ({
        conversationId: String(row.conversation_id),
        kind: String(row.principal_kind) as "user" | "agent",
        principalId: String(row.principal_id),
        role: String(row.role) as "owner" | "admin" | "member",
        joinedAt: String(row.joined_at),
      })),
    });
  }

  /** Memberships owned by the authenticated principal only.
   *
   * Unlike the workspace-wide roster endpoint, this is safe for every
   * workspace member and gives clients one authoritative, least-privilege
   * source for sidebar visibility and notification eligibility.
   */
  currentPrincipalMembershipsList(
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const { kind, id } = principalKindId(context.principal);
    if (kind === "service") {
      throw new HttpError(
        403,
        "principal_required",
        "Only a user or agent has channel memberships.",
      );
    }
    const rows = this.store.storage.sql
      .exec(
        `SELECT conversation_id, principal_kind, principal_id, role, joined_at
         FROM channel_members
         WHERE principal_kind = ? AND principal_id = ?
         ORDER BY conversation_id`,
        kind,
        id,
      )
      .toArray() as ChannelMemberRow[];
    return json({
      memberships: rows.map((row) => ({
        conversationId: String(row.conversation_id),
        kind: String(row.principal_kind) as "user" | "agent",
        principalId: String(row.principal_id),
        role: String(row.role) as "owner" | "admin" | "member",
        joinedAt: String(row.joined_at),
      })),
    });
  }

  async channelsMembersAdd(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelMemberAddCommandSchema.parse(
      await parseJson(request),
    );
    const conversationId = command.payload.conversationId;
    this.store.requireChannel(conversationId);
    this.store.requireChannelManager(conversationId, context.principal);
    const receipt = firstRow<ChannelMembershipBatchRow>(
      this.store.storage.sql.exec(
        "SELECT * FROM channel_membership_batches WHERE command_id = ?",
        command.commandId,
      ),
    );
    if (receipt) {
      if (receipt.conversation_id !== conversationId) {
        throw new HttpError(
          409,
          "command_reuse_denied",
          "This command id already belongs to another channel operation.",
        );
      }
      await this.publishPendingMembershipBatch(context.workspaceId, receipt);
      return json(channelActionResultSchema.parse({ ok: true }));
    }

    const requested = uniqueMemberTargets(
      "members" in command.payload
        ? command.payload.members
        : [
            {
              kind: command.payload.kind,
              principalId: command.payload.principalId,
            },
          ],
    );
    for (const target of requested) {
      this.store.requireWorkspaceMember(target.kind, target.principalId);
    }
    const additions = requested.filter(
      (target) =>
        !this.store.channelMembership(
          conversationId,
          target.kind,
          target.principalId,
        ),
    );
    const now = new Date().toISOString();
    const pendingEvent: PendingChannelMembershipBatchEvent = {
      commandId: command.commandId,
      messageId: crypto.randomUUID(),
      actor: context.principal,
      targets: additions.map((target) => ({
        kind: target.kind,
        id: target.principalId,
        name:
          target.kind === "user"
            ? "you"
            : (defaultWorkspaceAgents.find(
                (agent) => agent.id === target.principalId,
              )?.name ?? humanizeIdentifier(target.principalId)),
      })),
      occurredAt: now,
    };
    this.store.storage.transactionSync(() => {
      for (const target of additions) {
        this.store.storage.sql.exec(
          `INSERT INTO channel_members (
            conversation_id, principal_kind, principal_id, role, joined_at
          ) VALUES (?, ?, ?, 'member', ?)
          ON CONFLICT(conversation_id, principal_kind, principal_id) DO NOTHING`,
          conversationId,
          target.kind,
          target.principalId,
          now,
        );
      }
      this.store.storage.sql.exec(
        `INSERT INTO channel_membership_batches (
          command_id, conversation_id, event_json, published
        ) VALUES (?, ?, ?, ?)`,
        command.commandId,
        conversationId,
        JSON.stringify(pendingEvent),
        additions.length > 0 ? 0 : 1,
      );
      this.store.rewriteSnapshot(() => undefined);
    });
    const pending = firstRow<ChannelMembershipBatchRow>(
      this.store.storage.sql.exec(
        "SELECT * FROM channel_membership_batches WHERE command_id = ?",
        command.commandId,
      ),
    );
    if (pending)
      await this.publishPendingMembershipBatch(context.workspaceId, pending);
    return json(channelActionResultSchema.parse({ ok: true }));
  }

  async publishPendingMembershipBatch(
    workspaceId: string,
    row: ChannelMembershipBatchRow,
  ) {
    if (row.published === 1) return;
    const event = parsePendingChannelMembershipBatchEvent(row.event_json);
    await this.publishMemberAddedEvent(workspaceId, row.conversation_id, event);
    this.store.storage.sql.exec(
      `UPDATE channel_membership_batches SET published = 1
       WHERE command_id = ?`,
      row.command_id,
    );
  }

  async publishMemberAddedEvent(
    workspaceId: string,
    conversationId: string,
    event: PendingChannelMembershipBatchEvent,
  ) {
    const parsedWorkspaceId = workspaceIdSchema.parse(workspaceId);
    const { commandId, messageId, actor, targets, occurredAt } = event;
    const actorId =
      actor.kind === "agent"
        ? actor.agentId
        : actor.kind === "user"
          ? actor.userId
          : actor.service;
    const actorName =
      actor.kind === "agent"
        ? (defaultWorkspaceAgents.find((agent) => agent.id === actor.agentId)
            ?.name ?? humanizeIdentifier(actor.agentId))
        : actor.kind === "user"
          ? "You"
          : "Chief";
    const targetNames = targets.map((target) => target.name);
    const body = `${actorName} added ${formatNameList(targetNames)} to the channel.`;
    const append = appendMessageCommandSchema.parse({
      commandId,
      protocolVersion: 1,
      occurredAt,
      payload: {
        messageId,
        conversationId,
        body,
        mentions: [],
        components: [
          {
            id: `membership-${commandId}`,
            kind: "channel-action",
            version: 1,
            payload: {
              type: "member-added",
              actorId,
              actorName,
              actorType: actor.kind,
              targetId: targets[0]?.id ?? "",
              targetKind: targets[0]?.kind ?? "agent",
              targetName: targets[0]?.name ?? "a member",
              targetIds: targets.map((target) => target.id).join(","),
              targetNames: targetNames.join(","),
            },
          },
        ],
      },
    });
    const relayPrincipal = {
      kind: "service" as const,
      service: "chief-relay",
      workspaceId: parsedWorkspaceId,
    };
    const workspace = this.store.requireWorkspace(parsedWorkspaceId);
    const conversation = this.store.env.CONVERSATIONS.get(
      this.store.env.CONVERSATIONS.idFromName(
        `${workspace.workspace_id}:${conversationId}`,
      ),
    );
    const response = await conversation.fetch(
      withTrustedContext(
        new Request("https://conversation.internal/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(append),
        }),
        {
          principal: relayPrincipal,
          requestId: commandId,
          workspaceId: parsedWorkspaceId,
          conversationId,
        },
      ),
    );
    if (!response.ok) {
      throw new HttpError(
        502,
        "membership_event_failed",
        "The channel membership event could not be published.",
      );
    }
  }

  async channelsMembersRemove(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelMemberRemoveCommandSchema.parse(
      await parseJson(request),
    );
    const conversationId = command.payload.conversationId;
    this.store.requireChannel(conversationId);
    const { kind, id } = principalKindId(context.principal);
    const actorMembership = firstRow<ChannelMemberRow>(
      this.store.storage.sql.exec(
        `SELECT * FROM channel_members
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        kind,
        id,
      ),
    );
    const targetMembership = firstRow<ChannelMemberRow>(
      this.store.storage.sql.exec(
        `SELECT * FROM channel_members
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        command.payload.kind,
        command.payload.principalId,
      ),
    );
    const isSelf =
      command.payload.kind === kind && command.payload.principalId === id;
    const isChannelOwner = actorMembership?.role === "owner";
    const isWorkspaceOwner = this.store.memberRole(kind, id) === "owner";
    if (targetMembership?.role === "owner" && !isWorkspaceOwner) {
      throw new HttpError(
        403,
        "channel_owner_remove_denied",
        "The channel owner can only be removed by a workspace owner.",
      );
    }
    if (!isSelf && !isChannelOwner && !isWorkspaceOwner) {
      throw new HttpError(
        403,
        "channel_member_remove_denied",
        "Only the member themselves, the channel owner, or a workspace owner can remove a member.",
      );
    }
    this.store.storage.transactionSync(() => {
      this.store.storage.sql.exec(
        `DELETE FROM channel_members
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        command.payload.kind,
        command.payload.principalId,
      );
      this.store.storage.sql.exec(
        `DELETE FROM channel_membership_events
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        command.payload.kind,
        command.payload.principalId,
      );
      this.store.rewriteSnapshot(() => undefined);
    });
    return json(channelActionResultSchema.parse({ ok: true }));
  }
}

function parsePendingChannelMembershipBatchEvent(
  value: string,
): PendingChannelMembershipBatchEvent {
  const candidate = JSON.parse(value) as Record<string, unknown>;
  if (!Array.isArray(candidate.targets)) {
    throw new HttpError(
      500,
      "membership_event_invalid",
      "The pending channel membership event is invalid.",
    );
  }
  const targets = candidate.targets.map((value) => {
    if (!value || typeof value !== "object") {
      throw new HttpError(
        500,
        "membership_event_invalid",
        "The pending channel membership event is invalid.",
      );
    }
    const target = value as Record<string, unknown>;
    if (!isMemberKind(target.kind)) {
      throw new HttpError(
        500,
        "membership_event_invalid",
        "The pending channel membership event is invalid.",
      );
    }
    const kind = target.kind;
    return {
      kind,
      id: String(target.id),
      name: String(target.name),
    };
  });
  return {
    commandId: commandIdSchema.parse(candidate.commandId),
    messageId: messageIdSchema.parse(candidate.messageId),
    actor: principalSchema.parse(candidate.actor),
    targets,
    occurredAt: isoDateTimeSchema.parse(candidate.occurredAt),
  };
}

function uniqueMemberTargets(
  targets: readonly { kind: "user" | "agent"; principalId: string }[],
) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.kind}:${target.principalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatNameList(names: readonly string[]) {
  if (names.length <= 1) return names[0] ?? "a member";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function isMemberKind(value: unknown): value is "user" | "agent" {
  return value === "user" || value === "agent";
}

function humanizeIdentifier(value: string) {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
