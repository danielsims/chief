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
import { recordMetrics } from "./metrics";
import {
  channelRecordFromRow,
  firstRow,
  parseChannelId,
  principalKindId,
} from "./workspace-channel-store";

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
    this.store.storage.transactionSync(() => {
      const existing = firstRow<ChannelRow>(
        this.store.storage.sql.exec(
          "SELECT conversation_id FROM channels WHERE conversation_id = ?",
          command.payload.conversationId,
        ),
      );
      if (existing) {
        throw new HttpError(
          409,
          "channel_already_exists",
          "A channel with that id already exists.",
        );
      }
      this.store.storage.sql.exec(
        `INSERT INTO channels (
          conversation_id, workspace_id, name, kind, is_private, archived, description,
          created_by_kind, created_by_id, version, created_at, updated_at
        ) VALUES (?, ?, ?, 'channel', ?, 0, NULL, ?, ?, 1, ?, ?)`,
        command.payload.conversationId,
        context.workspaceId,
        command.payload.name,
        command.payload.isPrivate ? 1 : 0,
        kind,
        id,
        now,
        now,
      );
      this.store.storage.sql.exec(
        `INSERT INTO channel_members (
          conversation_id, principal_kind, principal_id, role, joined_at
        ) VALUES (?, ?, ?, 'owner', ?)`,
        command.payload.conversationId,
        kind,
        id,
        now,
      );
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
    recordMetrics(this.store.env, ["channel-created"]);
    return json(this.store.channelDetail(command.payload.conversationId), {
      status: 201,
    });
  }

  channelsList(context: ReturnType<typeof readTrustedContext>) {
    const { kind, id } = principalKindId(context.principal);
    const rows = this.store.storage.sql
      .exec(
        `SELECT c.conversation_id, c.workspace_id, c.name, c.is_private,
                c.archived, c.created_at
         FROM channels c
         WHERE c.kind = 'channel' AND (c.is_private = 0 OR EXISTS (
           SELECT 1 FROM channel_members cm
           WHERE cm.conversation_id = c.conversation_id
             AND cm.principal_kind = ? AND cm.principal_id = ?
         ))
         ORDER BY archived ASC, created_at ASC, conversation_id ASC`,
        kind,
        id,
      )
      .toArray() as ChannelRow[];
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
    this.store.requireAgentCapability(context.principal, "messages");
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

    const existing = firstRow<ChannelRow>(
      this.store.storage.sql.exec(
        `SELECT c.* FROM channels c
         WHERE c.kind = 'direct'
           AND EXISTS (SELECT 1 FROM channel_members a
             WHERE a.conversation_id = c.conversation_id
               AND a.principal_kind = ? AND a.principal_id = ?)
           AND EXISTS (SELECT 1 FROM channel_members b
             WHERE b.conversation_id = c.conversation_id
               AND b.principal_kind = ? AND b.principal_id = ?)
         ORDER BY c.created_at ASC LIMIT 1`,
        kind,
        id,
        target.kind,
        target.principalId,
      ),
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
      this.store.storage.sql.exec(
        `INSERT INTO channels (
          conversation_id, workspace_id, name, kind, is_private, archived,
          description, created_by_kind, created_by_id, version, created_at,
          updated_at
        ) VALUES (?, ?, ?, 'direct', 1, 0, NULL, ?, ?, 1, ?, ?)`,
        conversationId,
        context.workspaceId,
        name,
        kind,
        id,
        now,
        now,
      );
      this.store.storage.sql.exec(
        `INSERT INTO channel_members (
          conversation_id, principal_kind, principal_id, role, joined_at
        ) VALUES (?, ?, ?, 'owner', ?), (?, ?, ?, 'member', ?)`,
        conversationId,
        kind,
        id,
        now,
        conversationId,
        target.kind,
        target.principalId,
        now,
      );
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
      this.store.storage.sql.exec(
        `UPDATE channels SET name = ?, is_private = ?, version = version + 1,
         updated_at = ? WHERE conversation_id = ?`,
        name,
        isPrivate ? 1 : 0,
        now,
        conversationId,
      );
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
      this.store.storage.sql.exec(
        `UPDATE channels SET archived = ?, version = version + 1,
         updated_at = ? WHERE conversation_id = ?`,
        archived ? 1 : 0,
        now,
        conversationId,
      );
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
    this.store.storage.sql.exec(
      `INSERT INTO channel_members (
        conversation_id, principal_kind, principal_id, role, joined_at
      ) VALUES (?, ?, ?, 'member', ?)
      ON CONFLICT(conversation_id, principal_kind, principal_id) DO NOTHING`,
      conversationId,
      kind,
      id,
      now,
    );
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
      this.store.storage.sql.exec(
        `SELECT * FROM channel_members
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        kind,
        id,
      ),
    );
    if (membership?.role === "owner") {
      throw new HttpError(
        403,
        "channel_owner_leave_denied",
        "The channel owner cannot leave a channel they own.",
      );
    }
    this.store.storage.sql.exec(
      `DELETE FROM channel_members
       WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
      conversationId,
      kind,
      id,
    );
    return json(channelActionResultSchema.parse({ ok: true }));
  }
}
