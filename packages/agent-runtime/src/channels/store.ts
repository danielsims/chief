import { randomUUID } from "node:crypto";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, asc, eq, sql } from "drizzle-orm";

import type {
  ChannelActorIdentity,
  ChannelAgentPermission,
  ChannelKind,
  ChannelWorkstream,
} from "@chief/channel-api";

import type { WorkspaceChannel } from "../types.js";
import * as schema from "../db/schema.js";
import { ChannelHistoryStore } from "./history-store.js";
import {
  defaultWorkspaceChannels,
  GETTING_STARTED_CHANNEL_ID,
} from "./nip29.js";

export class ChannelStore extends ChannelHistoryStore {
  private readonly seededWorkspaces = new Map<string, Promise<void>>();
  private readonly lifecycleMutations = new Map<string, Promise<void>>();

  constructor(database: () => LibSQLDatabase, ready: Promise<void>) {
    super(database, ready);
  }

  private withLifecycleLock<T>(
    workspaceId: string,
    mutation: () => Promise<T>,
  ) {
    const previous =
      this.lifecycleMutations.get(workspaceId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(mutation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.lifecycleMutations.set(workspaceId, settled);
    return result.finally(() => {
      if (this.lifecycleMutations.get(workspaceId) === settled) {
        this.lifecycleMutations.delete(workspaceId);
      }
    });
  }

  private seedWorkspace(workspaceId: string) {
    const existing = this.seededWorkspaces.get(workspaceId);
    if (existing) return existing;
    const seed = this.ready
      .then(async () => {
        const existing = await this.database()
          .select({ id: schema.channels.id })
          .from(schema.channels)
          .where(eq(schema.channels.organizationId, workspaceId))
          .all();
        const defaults = defaultWorkspaceChannels();
        const channelsToSeed =
          existing.length === 0
            ? defaults
            : defaults
                .filter((channel) => channel.id === GETTING_STARTED_CHANNEL_ID)
                .filter(
                  (channel) =>
                    !existing.some((candidate) => candidate.id === channel.id),
                )
                .map((channel) => ({
                  ...channel,
                  createdAt: 0,
                  updatedAt: Date.now(),
                }));
        if (channelsToSeed.length === 0) return;
        await this.database()
          .insert(schema.channels)
          .values(
            channelsToSeed.map(({ visibility, ...channel }) => ({
              organizationId: workspaceId,
              ...channel,
              visibility:
                visibility === "private"
                  ? ("private" as const)
                  : ("public" as const),
            })),
          )
          .onConflictDoNothing()
          .run();
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        this.seededWorkspaces.delete(workspaceId);
        throw error;
      });
    this.seededWorkspaces.set(workspaceId, seed);
    return seed;
  }

  async list(workspaceId: string): Promise<WorkspaceChannel[]> {
    await this.seedWorkspace(workspaceId);
    const db = this.database();
    return db
      .select({
        protocol: schema.channels.protocol,
        id: schema.channels.id,
        slug: schema.channels.slug,
        name: schema.channels.name,
        topic: schema.channels.topic,
        description: schema.channels.description,
        agentIds: schema.channels.agentIds,
        storedVisibility: schema.channels.visibility,
        kind: schema.channels.kind,
        lifecycle: schema.channels.lifecycle,
        archivedAt: schema.channels.archivedAt,
        createdBy: schema.channels.createdBy,
        agentPermissions: schema.channels.agentPermissions,
        workstream: schema.channels.workstream,
        version: schema.channels.version,
        createdAt: schema.channels.createdAt,
        updatedAt: schema.channels.updatedAt,
      })
      .from(schema.channels)
      .where(eq(schema.channels.organizationId, workspaceId))
      .orderBy(asc(schema.channels.createdAt), asc(schema.channels.slug))
      .all()
      .then((channels) =>
        channels.map(({ storedVisibility, ...channel }) => ({
          ...channel,
          archivedAt: channel.archivedAt ?? undefined,
          createdBy: channel.createdBy ?? {
            type: "user" as const,
            id: "workspace",
            name: "Workspace",
          },
          agentPermissions: channel.agentPermissions ?? [],
          workstream: channel.workstream ?? undefined,
          visibility: channel.slug.startsWith("dm-")
            ? ("direct" as const)
            : channel.slug === "getting-started"
              ? ("private" as const)
              : storedVisibility,
        })),
      );
  }

  async get(workspaceId: string, channelId: string) {
    return (await this.list(workspaceId)).find(
      (channel) => channel.id === channelId || channel.slug === channelId,
    );
  }

  async create(
    workspaceId: string,
    input: {
      name: string;
      description?: string;
      topic?: string;
      visibility?: "public" | "private";
      kind?: ChannelKind;
      actor?: ChannelActorIdentity;
      agentIds?: readonly string[];
      agentPermissions?: readonly ChannelAgentPermission[];
      workstream?: ChannelWorkstream;
      operationKey?: string;
      strictName?: boolean;
    },
  ) {
    const name = input.name.trim().slice(0, 60);
    if (!name) throw new Error("Channel name is required.");
    const baseSlug =
      name
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "channel";
    const existing = await this.list(workspaceId);
    if (input.operationKey) {
      const prior = await this.database()
        .select({ id: schema.channels.id })
        .from(schema.channels)
        .where(
          and(
            eq(schema.channels.organizationId, workspaceId),
            eq(schema.channels.operationKey, input.operationKey),
          ),
        )
        .get();
      if (prior) {
        const channel = await this.get(workspaceId, prior.id);
        if (channel) return channel;
      }
    }
    if (
      input.strictName &&
      existing.some((channel) => channel.slug === baseSlug)
    ) {
      throw new Error(`A channel named #${baseSlug} already exists.`);
    }
    let slug = baseSlug;
    let suffix = 2;
    while (existing.some((channel) => channel.slug === slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    const now = Date.now();
    const description = input.description?.trim().slice(0, 160);
    const channel: WorkspaceChannel = {
      protocol: "nip29",
      id: randomUUID(),
      slug,
      name,
      topic: input.topic?.trim().slice(0, 250) ?? "",
      description: description ?? `Work and conversation in #${name}`,
      agentIds: [...new Set(input.agentIds ?? ["cmo"])],
      visibility: input.visibility ?? "public",
      kind: input.kind ?? "standard",
      lifecycle: "active",
      createdBy: input.actor ?? {
        type: "user",
        id: "workspace-owner",
        name: "Workspace owner",
      },
      agentPermissions: [...new Set(input.agentPermissions ?? [])],
      workstream: input.workstream,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.database()
      .insert(schema.channels)
      .values({
        organizationId: workspaceId,
        ...channel,
        visibility: channel.visibility === "private" ? "private" : "public",
        operationKey: input.operationKey,
      })
      .run();
    await this.audit(
      workspaceId,
      channel.id,
      "channel.created",
      channel.createdBy,
      {
        name: channel.name,
        kind: channel.kind,
        visibility: channel.visibility,
      },
    );
    return channel;
  }

  async update(
    workspaceId: string,
    channelId: string,
    input: {
      name?: string;
      topic?: string;
      description?: string;
      workstream?: ChannelWorkstream;
      expectedVersion?: number;
      actor?: ChannelActorIdentity;
    },
  ) {
    const channel = await this.get(workspaceId, channelId);
    if (!channel) throw new Error("Channel was not found in this workspace.");
    if (channel.visibility === "direct") {
      throw new Error("Direct messages cannot be edited as channels.");
    }
    this.assertVersion(channel, input.expectedVersion);
    const name = input.name?.trim() ?? channel.name;
    const topic = input.topic?.trim() ?? channel.topic;
    const description = input.description?.trim() ?? channel.description;
    if (!name) throw new Error("Channel name is required.");
    if (name.length > 60) {
      throw new Error("Channel names can be at most 60 characters.");
    }
    if (description.length > 160) {
      throw new Error("Channel descriptions can be at most 160 characters.");
    }
    if (topic.length > 250) {
      throw new Error("Channel topics can be at most 250 characters.");
    }
    const updatedAt = Date.now();
    const version = channel.version + 1;
    const result = await this.database()
      .update(schema.channels)
      .set({
        name,
        topic,
        description,
        workstream: input.workstream ?? channel.workstream,
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
    // The stable slug is deliberately retained so existing links keep working.
    const updated = {
      ...channel,
      name,
      topic,
      description,
      workstream: input.workstream ?? channel.workstream,
      version,
      updatedAt,
    };
    await this.audit(
      workspaceId,
      channel.id,
      "channel.updated",
      input.actor ?? {
        type: "user",
        id: "workspace-owner",
        name: "Workspace owner",
      },
      { version },
    );
    return updated;
  }

  async setPolicy(
    workspaceId: string,
    channelId: string,
    agentPermissions: readonly ChannelAgentPermission[],
    actor: ChannelActorIdentity,
  ) {
    const channel = await this.get(workspaceId, channelId);
    if (!channel) throw new Error("Channel was not found in this workspace.");
    if (channel.visibility === "direct") {
      throw new Error(
        "Direct messages do not have channel management policies.",
      );
    }
    const nextPermissions = [...new Set(agentPermissions)];
    const updatedAt = Date.now();
    const version = channel.version + 1;
    const result = await this.database()
      .update(schema.channels)
      .set({ agentPermissions: nextPermissions, version, updatedAt })
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          eq(schema.channels.id, channel.id),
          eq(schema.channels.version, channel.version),
        ),
      )
      .run();
    this.assertWriteApplied(result.rowsAffected);
    await this.audit(workspaceId, channel.id, "policy.updated", actor, {
      agentPermissions: nextPermissions,
    });
    return {
      ...channel,
      agentPermissions: nextPermissions,
      version,
      updatedAt,
    };
  }

  async setArchived(
    workspaceId: string,
    channelId: string,
    archived: boolean,
    input: { expectedVersion?: number; actor: ChannelActorIdentity },
  ) {
    return this.withLifecycleLock(workspaceId, () =>
      this.setArchivedLocked(workspaceId, channelId, archived, input),
    );
  }

  private async setArchivedLocked(
    workspaceId: string,
    channelId: string,
    archived: boolean,
    input: { expectedVersion?: number; actor: ChannelActorIdentity },
  ) {
    const channel = await this.assertRemovable(workspaceId, channelId);
    this.assertVersion(channel, input.expectedVersion);
    if ((channel.lifecycle === "archived") === archived) return channel;
    const updatedAt = Date.now();
    const archivedAt = archived ? updatedAt : undefined;
    const lifecycle = archived ? "archived" : "active";
    const version = channel.version + 1;
    const result = await this.database()
      .update(schema.channels)
      .set({
        lifecycle,
        archivedAt: archivedAt ?? null,
        version,
        updatedAt,
      })
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          eq(schema.channels.id, channel.id),
          eq(schema.channels.version, channel.version),
          archived && channel.visibility === "public"
            ? sql`EXISTS (
                SELECT 1 FROM channel AS remaining
                WHERE remaining.organization_id = ${workspaceId}
                  AND remaining.id <> ${channel.id}
                  AND remaining.visibility = 'public'
                  AND remaining.lifecycle = 'active'
              )`
            : undefined,
        ),
      )
      .run();
    if (result.rowsAffected === 0) {
      const current = await this.get(workspaceId, channel.id);
      if (current?.version !== channel.version) {
        this.assertWriteApplied(result.rowsAffected);
      }
      if (archived && channel.visibility === "public") {
        throw new Error("A workspace must keep at least one channel active.");
      }
      this.assertWriteApplied(result.rowsAffected);
    }
    const updated = {
      ...channel,
      lifecycle,
      archivedAt,
      version,
      updatedAt,
    } as WorkspaceChannel;
    await this.audit(
      workspaceId,
      channel.id,
      archived ? "channel.archived" : "channel.unarchived",
      input.actor,
      { version },
    );
    return updated;
  }

  async assertRemovable(workspaceId: string, channelId: string) {
    const channel = await this.get(workspaceId, channelId);
    if (!channel) throw new Error("Channel was not found in this workspace.");
    if (channel.visibility === "direct") {
      throw new Error("Direct messages cannot be deleted as channels.");
    }
    if (channel.id === GETTING_STARTED_CHANNEL_ID) {
      throw new Error("The getting-started channel belongs to the workspace.");
    }
    const remainingActivePublicChannels = (await this.list(workspaceId)).filter(
      (candidate) =>
        candidate.visibility === "public" &&
        candidate.lifecycle === "active" &&
        candidate.id !== channel.id,
    );
    if (
      channel.visibility === "public" &&
      channel.lifecycle === "active" &&
      remainingActivePublicChannels.length === 0
    ) {
      throw new Error("A workspace must keep at least one channel active.");
    }
    return channel;
  }

  async remove(workspaceId: string, channelId: string) {
    return this.withLifecycleLock(workspaceId, () =>
      this.removeLocked(workspaceId, channelId),
    );
  }

  private async removeLocked(workspaceId: string, channelId: string) {
    const channel = await this.assertRemovable(workspaceId, channelId);
    await this.database().transaction(async (tx) => {
      await tx
        .delete(schema.channelAudit)
        .where(
          and(
            eq(schema.channelAudit.organizationId, workspaceId),
            eq(schema.channelAudit.channelId, channel.id),
          ),
        )
        .run();
      await tx
        .delete(schema.channelEvents)
        .where(
          and(
            eq(schema.channelEvents.organizationId, workspaceId),
            eq(schema.channelEvents.channelId, channel.id),
          ),
        )
        .run();
      await tx
        .delete(schema.channels)
        .where(
          and(
            eq(schema.channels.organizationId, workspaceId),
            eq(schema.channels.id, channel.id),
          ),
        )
        .run();
    });
    return channel;
  }
}
