import { createHash, randomUUID } from "node:crypto";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, asc, desc, eq } from "drizzle-orm";

import type {
  ChannelActorIdentity,
  ChannelAuditAction,
  ChannelAuditDetailValue,
  ChannelAuditEntry,
} from "@chief/channel-api";

import type { ChannelEvent, WorkspaceChannel } from "../channel-types.js";
import * as schema from "../db/schema.js";

export abstract class ChannelHistoryStore {
  private readonly auditQueues = new Map<string, Promise<unknown>>();
  constructor(
    protected readonly database: () => LibSQLDatabase,
    protected readonly ready: Promise<void>,
  ) {}

  abstract get(
    workspaceId: string,
    channelId: string,
  ): Promise<WorkspaceChannel | undefined>;

  protected assertVersion(channel: WorkspaceChannel, expected?: number) {
    if (expected !== undefined && channel.version !== expected) {
      throw new Error(
        `Channel changed since it was read. Expected version ${expected}, current version is ${channel.version}.`,
      );
    }
  }

  protected assertWriteApplied(rowsAffected: number) {
    if (rowsAffected === 0) {
      throw new Error(
        "Channel changed since it was read. Refresh it before retrying.",
      );
    }
  }

  async appendEvent(workspaceId: string, event: ChannelEvent) {
    await this.ready;
    if (!(await this.get(workspaceId, event.channelId))) {
      throw new Error("Channel was not found in this workspace.");
    }
    await this.database()
      .insert(schema.channelEvents)
      .values({ organizationId: workspaceId, ...event })
      .onConflictDoNothing()
      .run();
    return event;
  }

  async removeEvent(workspaceId: string, eventId: string) {
    await this.ready;
    await this.database()
      .delete(schema.channelEvents)
      .where(
        and(
          eq(schema.channelEvents.organizationId, workspaceId),
          eq(schema.channelEvents.id, eventId),
        ),
      )
      .run();
  }

  async addAgents(
    workspaceId: string,
    channelId: string,
    agentIds: readonly string[],
    expectedVersion?: number,
  ) {
    return this.addMembers(
      workspaceId,
      channelId,
      agentIds,
      [],
      expectedVersion,
    );
  }

  async addUsers(
    workspaceId: string,
    channelId: string,
    userIds: readonly string[],
    expectedVersion?: number,
  ) {
    return this.addMembers(
      workspaceId,
      channelId,
      [],
      userIds,
      expectedVersion,
    );
  }

  async addMembers(
    workspaceId: string,
    channelId: string,
    agentIds: readonly string[],
    userIds: readonly string[],
    expectedVersion?: number,
  ) {
    const channel = await this.get(workspaceId, channelId);
    if (
      !channel ||
      channel.visibility === "direct" ||
      (agentIds.length === 0 && userIds.length === 0)
    ) {
      return channel;
    }
    this.assertVersion(channel, expectedVersion);
    const nextAgentIds = [...new Set([...channel.agentIds, ...agentIds])];
    const nextUserIds = [...new Set([...channel.userIds, ...userIds])];
    if (
      nextAgentIds.length === channel.agentIds.length &&
      nextUserIds.length === channel.userIds.length
    ) {
      return channel;
    }
    const updatedAt = Date.now();
    const version = channel.version + 1;
    const result = await this.database()
      .update(schema.channels)
      .set({
        agentIds: nextAgentIds,
        userIds: nextUserIds,
        version,
        updatedAt,
      })
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          eq(schema.channels.id, channel.id),
          eq(schema.channels.version, channel.version),
        ),
      )
      .run();
    this.assertWriteApplied(result.rowsAffected);
    return {
      ...channel,
      agentIds: nextAgentIds,
      userIds: nextUserIds,
      version,
      updatedAt,
    };
  }

  async removeAgent(
    workspaceId: string,
    channelId: string,
    agentId: string,
    expectedVersion?: number,
  ) {
    const channel = await this.get(workspaceId, channelId);
    if (!channel || channel.visibility === "direct") return channel;
    this.assertVersion(channel, expectedVersion);
    const nextAgentIds = channel.agentIds.filter(
      (candidate) => candidate !== agentId,
    );
    if (nextAgentIds.length === channel.agentIds.length) return channel;
    const updatedAt = Date.now();
    const version = channel.version + 1;
    const result = await this.database()
      .update(schema.channels)
      .set({ agentIds: nextAgentIds, version, updatedAt })
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          eq(schema.channels.id, channel.id),
          eq(schema.channels.version, channel.version),
        ),
      )
      .run();
    this.assertWriteApplied(result.rowsAffected);
    return { ...channel, agentIds: nextAgentIds, version, updatedAt };
  }

  async setAgents(
    workspaceId: string,
    channelId: string,
    agentIds: readonly string[],
  ) {
    const channel = await this.get(workspaceId, channelId);
    if (!channel || channel.visibility === "direct") return channel;
    const nextAgentIds = [...new Set(agentIds)];
    const updatedAt = Date.now();
    const version = channel.version + 1;
    const result = await this.database()
      .update(schema.channels)
      .set({ agentIds: nextAgentIds, version, updatedAt })
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          eq(schema.channels.id, channel.id),
          eq(schema.channels.version, channel.version),
        ),
      )
      .run();
    this.assertWriteApplied(result.rowsAffected);
    return { ...channel, agentIds: nextAgentIds, version, updatedAt };
  }

  async setUsers(
    workspaceId: string,
    channelId: string,
    userIds: readonly string[],
  ) {
    const channel = await this.get(workspaceId, channelId);
    if (!channel || channel.visibility === "direct") return channel;
    const nextUserIds = [...new Set(userIds)];
    if (
      nextUserIds.length === channel.userIds.length &&
      nextUserIds.every((userId) => channel.userIds.includes(userId))
    ) {
      return channel;
    }
    const updatedAt = Date.now();
    const version = channel.version + 1;
    const result = await this.database()
      .update(schema.channels)
      .set({ userIds: nextUserIds, version, updatedAt })
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          eq(schema.channels.id, channel.id),
          eq(schema.channels.version, channel.version),
        ),
      )
      .run();
    this.assertWriteApplied(result.rowsAffected);
    return { ...channel, userIds: nextUserIds, version, updatedAt };
  }

  async audit(
    workspaceId: string,
    channelId: string,
    action: ChannelAuditAction,
    actor: ChannelActorIdentity,
    detail: Record<string, ChannelAuditDetailValue> = {},
  ) {
    const key = `${workspaceId}\0${channelId}`;
    const previous = this.auditQueues.get(key) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(async () => {
        const prior = await this.database()
          .select({
            sequence: schema.channelAudit.sequence,
            hash: schema.channelAudit.hash,
          })
          .from(schema.channelAudit)
          .where(
            and(
              eq(schema.channelAudit.organizationId, workspaceId),
              eq(schema.channelAudit.channelId, channelId),
            ),
          )
          .orderBy(
            desc(schema.channelAudit.sequence),
            desc(schema.channelAudit.createdAt),
          )
          .get();
        const sequence = (prior?.sequence ?? 0) + 1;
        const previousHash = prior?.hash ?? undefined;
        const createdAt = Date.now();
        const id = randomUUID();
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              workspaceId,
              channelId,
              sequence,
              previousHash: previousHash ?? null,
              id,
              action,
              actor,
              detail,
              createdAt,
            }),
          )
          .digest("hex");
        const entry: ChannelAuditEntry = {
          id,
          channelId,
          action,
          actor,
          detail,
          sequence,
          previousHash,
          hash,
          createdAt,
        };
        await this.database()
          .insert(schema.channelAudit)
          .values({ organizationId: workspaceId, ...entry })
          .run();
        return entry;
      });
    this.auditQueues.set(key, queued);
    try {
      return await queued;
    } finally {
      if (this.auditQueues.get(key) === queued) this.auditQueues.delete(key);
    }
  }

  async activity(workspaceId: string, channelId: string) {
    await this.ready;
    return this.database()
      .select({
        id: schema.channelAudit.id,
        channelId: schema.channelAudit.channelId,
        action: schema.channelAudit.action,
        actor: schema.channelAudit.actor,
        detail: schema.channelAudit.detail,
        sequence: schema.channelAudit.sequence,
        previousHash: schema.channelAudit.previousHash,
        hash: schema.channelAudit.hash,
        createdAt: schema.channelAudit.createdAt,
      })
      .from(schema.channelAudit)
      .where(
        and(
          eq(schema.channelAudit.organizationId, workspaceId),
          eq(schema.channelAudit.channelId, channelId),
        ),
      )
      .orderBy(asc(schema.channelAudit.createdAt))
      .all()
      .then((entries) =>
        entries.map((entry) => ({
          ...entry,
          previousHash: entry.previousHash ?? undefined,
          hash: entry.hash ?? "",
        })),
      );
  }

  async events(
    workspaceId: string,
    channelId: string,
  ): Promise<ChannelEvent[]> {
    await this.ready;
    return this.database()
      .select({
        protocol: schema.channelEvents.protocol,
        id: schema.channelEvents.id,
        channelId: schema.channelEvents.channelId,
        kind: schema.channelEvents.kind,
        pubkey: schema.channelEvents.pubkey,
        tags: schema.channelEvents.tags,
        content: schema.channelEvents.content,
        parts: schema.channelEvents.parts,
        actor: schema.channelEvents.actor,
        createdAt: schema.channelEvents.createdAt,
      })
      .from(schema.channelEvents)
      .where(
        and(
          eq(schema.channelEvents.organizationId, workspaceId),
          eq(schema.channelEvents.channelId, channelId),
        ),
      )
      .orderBy(asc(schema.channelEvents.createdAt))
      .all()
      .then((events) =>
        events.flatMap((event): ChannelEvent[] => {
          if (event.kind === 5) return [{ ...event, kind: 5 }];
          if (event.kind === 7) return [{ ...event, kind: 7 }];
          if (event.kind === 9) {
            return [{ ...event, kind: 9, parts: event.parts ?? undefined }];
          }
          if (event.kind === 40003) return [{ ...event, kind: 40003 }];
          return [];
        }),
      );
  }
}
