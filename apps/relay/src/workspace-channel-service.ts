import { z } from "zod";

import type { channelArchiveCommandSchema } from "@chief/relay-contracts";
import {
  channelActionResultSchema,
  channelCreateCommandSchema,
  channelJoinCommandSchema,
  channelLeaveCommandSchema,
  channelListResultSchema,
  channelUpdateCommandSchema,
  directStartCommandSchema,
  directStartResultSchema,
} from "@chief/relay-contracts";

import type {
  ChannelMemberRow,
  ChannelRow,
  WorkspaceChannelStore,
} from "./workspace-channel-store";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { recordProductEvents } from "./product-events";
import { channelMembersDeleteChannelsMembersRemove } from "./queries/channel-members/delete-channels-members-remove";
import { channelMembersFindChannelsMembersRemove } from "./queries/channel-members/find-channels-members-remove";
import { channelMembersInsertChannelsCreate } from "./queries/channel-members/insert-channels-create";
import { channelMembersInsertChannelsMembersAdd } from "./queries/channel-members/insert-channels-members-add";
import { channelMembersInsertDirectMembers } from "./queries/channel-members/insert-direct-members";
import { channelsFindChannelsCreate } from "./queries/channels/find-channels-create";
import { channelsFindDirectBetweenMembers } from "./queries/channels/find-direct-between-members";
import { channelsInsertChannelsCreate } from "./queries/channels/insert-channels-create";
import { channelsInsertDirectsStart } from "./queries/channels/insert-directs-start";
import { channelsListVisibleChannels } from "./queries/channels/list-visible-channels";
import { channelsUpdateChannelsArchive } from "./queries/channels/update-channels-archive";
import { channelsUpdateChannelsUpdate } from "./queries/channels/update-channels-update";
import { requireAgentMessageAccess } from "./workspace-agent-messaging";
import {
  channelRecordFromRow,
  firstRow,
  parseChannelId,
  principalKindId,
} from "./workspace-channel-store";

const channelListRowSchema = z.object({
  conversation_id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  is_private: z.number(),
  archived: z.number(),
  created_at: z.string(),
});

export class WorkspaceChannelService {
  constructor(private readonly store: WorkspaceChannelStore) {}

  async channelsCreate(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelCreateCommandSchema.parse(await parseJson(request));
    const { kind, id } = principalKindId(context.principal);
    if (kind === "service") {
      throw new HttpError(
        403,
        "principal_required",
        "Only a user or agent can create a channel.",
      );
    }
    const now = new Date().toISOString();
    const existing = firstRow<ChannelRow>(
      channelsFindChannelsCreate(
        this.store.storage,
        command.payload.conversationId,
      ),
    );
    if (existing) {
      const matches =
        existing.kind === "channel" &&
        existing.name === command.payload.name &&
        Number(existing.is_private) === (command.payload.isPrivate ? 1 : 0);
      if (matches) {
        if (kind === "agent") {
          this.store.ensureChannelOwner(
            command.payload.conversationId,
            kind,
            id,
            now,
          );
        }
        return json(this.store.channelDetail(command.payload.conversationId));
      }
      throw new HttpError(
        409,
        "channel_already_exists",
        "A different channel already uses that id.",
      );
    }
    this.store.storage.transactionSync(() => {
      channelsInsertChannelsCreate(this.store.storage, {
        conversationId: command.payload.conversationId,
        workspaceId: context.workspaceId,
        name: command.payload.name,
        isPrivate: command.payload.isPrivate ? 1 : 0,
        createdByKind: kind,
        createdById: id,
        createdAt: now,
        updatedAt: now,
      });
      channelMembersInsertChannelsCreate(this.store.storage, {
        conversationId: command.payload.conversationId,
        principalKind: kind,
        principalId: id,
        joinedAt: now,
      });
      this.store.rewriteSnapshot((conversations) => {
        conversations.push({
          id: command.payload.conversationId,
          name: command.payload.name,
          kind: "channel",
          isPrivate: command.payload.isPrivate,
          archived: false,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        });
      });
    });
    recordProductEvents(this.store.env, ["channel-created"]);
    return json(this.store.channelDetail(command.payload.conversationId), {
      status: 201,
    });
  }

  channelsList(context: ReturnType<typeof readTrustedContext>) {
    const { kind, id } = principalKindId(context.principal);
    const rows = channelsListVisibleChannels(this.store.storage, kind, id).map(
      (row) => channelListRowSchema.parse(row),
    );
    return json(
      channelListResultSchema.parse({
        channels: rows.map(channelRecordFromRow),
      }),
    );
  }

  /** Starts or reuses a two-party direct conversation. Membership is derived
   * exclusively from the authenticated principal and a current workspace
   * member, so clients cannot smuggle arbitrary participants into a DM. */
  async directsStart(request: Request) {
    const context = readTrustedContext(request);
    this.store.requirePrincipalMember(context.principal);
    this.store.requireAgentCapability(context.principal, "messages.send");
    const { kind, id } = principalKindId(context.principal);
    if (kind === "service") {
      throw new HttpError(
        403,
        "principal_required",
        "A user or agent is required.",
      );
    }
    const command = directStartCommandSchema.parse(await parseJson(request));
    const target = command.payload.participant;
    if (target.kind === kind && target.principalId === id) {
      throw new HttpError(
        400,
        "direct_self_denied",
        "Choose another workspace member.",
      );
    }
    this.store.requireWorkspaceMember(target.kind, target.principalId);
    if (target.kind === "agent")
      requireAgentMessageAccess(
        this.store,
        target.principalId,
        context.principal,
      );

    const existing = firstRow<ChannelRow>(
      channelsFindDirectBetweenMembers(this.store.storage, {
        firstKind: kind,
        firstId: id,
        secondKind: target.kind,
        secondId: target.principalId,
      }),
    );
    if (existing) {
      return json(
        directStartResultSchema.parse({
          conversation: this.directSummary(
            existing,
            target.kind,
            target.principalId,
          ),
        }),
      );
    }
    const pair = [`${kind}:${id}`, `${target.kind}:${target.principalId}`]
      .sort()
      .join("|");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(pair),
    );
    const conversationId = `dm-${Array.from(new Uint8Array(digest))
      .slice(0, 16)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
    const name = this.principalDisplayName(target.kind, target.principalId);
    const now = new Date().toISOString();
    this.store.storage.transactionSync(() => {
      channelsInsertDirectsStart(this.store.storage, {
        conversationId: conversationId,
        workspaceId: context.workspaceId,
        name: name,
        createdByKind: kind,
        createdById: id,
        createdAt: now,
        updatedAt: now,
      });
      channelMembersInsertDirectMembers(this.store.storage, {
        conversationId: conversationId,
        ownerKind: kind,
        ownerId: id,
        ownerJoinedAt: now,
        memberConversationId: conversationId,
        memberKind: target.kind,
        memberId: target.principalId,
        memberJoinedAt: now,
      });
      this.store.rewriteSnapshot((conversations) => {
        conversations.push({
          id: conversationId,
          name,
          kind: "direct",
          isPrivate: true,
          archived: false,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        });
      });
    });
    return json(
      directStartResultSchema.parse({
        conversation: this.directSummary(
          this.store.requireChannel(conversationId),
          target.kind,
          target.principalId,
        ),
      }),
      { status: 201 },
    );
  }

  directSummary(
    row: ChannelRow,
    targetKind: "user" | "agent",
    targetId: string,
  ) {
    return {
      id: String(row.conversation_id),
      name: this.principalDisplayName(targetKind, targetId),
      kind: "direct" as const,
      isPrivate: true,
      archived: Number(row.archived) === 1,
      unreadCount: 0,
      requiresAttention: false,
      lastMessage: null,
    };
  }

  principalDisplayName(kind: "user" | "agent", principalId: string) {
    return (
      this.store.principalNames().get(`${kind}:${principalId}`) ?? principalId
    );
  }

  channelsGet(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const conversationId = parseChannelId(
      new URL(request.url).searchParams.get("conversationId"),
    );
    this.store.requireChannelVisible(conversationId, context.principal);
    return json(this.store.channelDetail(conversationId));
  }

  async channelsUpdate(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelUpdateCommandSchema.parse(await parseJson(request));
    const conversationId = command.payload.conversationId;
    const existing = this.store.requireChannel(conversationId);
    this.store.requireChannelManager(conversationId, context.principal);
    const name = command.payload.name ?? String(existing.name);
    const isPrivate =
      command.payload.isPrivate ?? Number(existing.is_private) === 1;
    const now = new Date().toISOString();
    this.store.storage.transactionSync(() => {
      channelsUpdateChannelsUpdate(this.store.storage, {
        name: name,
        isPrivate: isPrivate ? 1 : 0,
        updatedAt: now,
        conversationId: conversationId,
      });
      this.store.rewriteSnapshot((conversations) => {
        const entry = conversations.find(
          (conversation) => conversation.id === conversationId,
        );
        if (entry) {
          entry.name = name;
          entry.isPrivate = isPrivate;
        }
      });
    });
    return json(this.store.channelRecord(conversationId));
  }

  async channelsArchive(
    request: Request,
    schema: typeof channelArchiveCommandSchema,
    archived: boolean,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = schema.parse(await parseJson(request));
    const conversationId = command.payload.conversationId;
    this.store.requireChannel(conversationId);
    this.store.requireChannelManager(conversationId, context.principal);
    const now = new Date().toISOString();
    this.store.storage.transactionSync(() => {
      channelsUpdateChannelsArchive(this.store.storage, {
        archived: archived ? 1 : 0,
        updatedAt: now,
        conversationId: conversationId,
      });
      this.store.rewriteSnapshot((conversations) => {
        const entry = conversations.find(
          (conversation) => conversation.id === conversationId,
        );
        if (entry) entry.archived = archived;
      });
    });
    return json(this.store.channelRecord(conversationId));
  }

  async channelsJoin(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelJoinCommandSchema.parse(await parseJson(request));
    const conversationId = command.payload.conversationId;
    const channel = this.store.requireChannel(conversationId);
    const { kind, id } = principalKindId(context.principal);
    if (kind === "service") {
      throw new HttpError(
        403,
        "principal_required",
        "Only a user or agent can join a channel.",
      );
    }
    if (
      Number(channel.is_private) === 1 &&
      !this.store.channelMembership(conversationId, kind, id)
    ) {
      throw new HttpError(
        403,
        "private_channel_invite_required",
        "Private channels require an invitation from a channel manager.",
      );
    }
    const now = new Date().toISOString();
    channelMembersInsertChannelsMembersAdd(this.store.storage, {
      conversationId: conversationId,
      principalKind: kind,
      principalId: id,
      joinedAt: now,
    });
    return json(channelActionResultSchema.parse({ ok: true }));
  }

  async channelsLeave(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelLeaveCommandSchema.parse(await parseJson(request));
    const conversationId = command.payload.conversationId;
    this.store.requireChannel(conversationId);
    const { kind, id } = principalKindId(context.principal);
    const membership = firstRow<ChannelMemberRow>(
      channelMembersFindChannelsMembersRemove(this.store.storage, {
        conversationId: conversationId,
        principalKind: kind,
        principalId: id,
      }),
    );
    if (membership?.role === "owner") {
      throw new HttpError(
        403,
        "channel_owner_leave_denied",
        "The channel owner cannot leave a channel they own.",
      );
    }
    channelMembersDeleteChannelsMembersRemove(this.store.storage, {
      conversationId: conversationId,
      principalKind: kind,
      principalId: id,
    });
    return json(channelActionResultSchema.parse({ ok: true }));
  }
}
