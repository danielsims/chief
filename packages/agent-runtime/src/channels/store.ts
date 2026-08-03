import { randomUUID } from "node:crypto";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, asc, eq } from "drizzle-orm";

import type { ChannelEvent, WorkspaceChannel } from "../types.js";
import * as schema from "../db/schema.js";
import {
  defaultWorkspaceChannels,
  GETTING_STARTED_CHANNEL_ID,
} from "./nip29.js";

export class ChannelStore {
  private readonly seededWorkspaces = new Map<string, Promise<void>>();

  constructor(
    private readonly database: () => LibSQLDatabase,
    private readonly ready: Promise<void>,
  ) {}

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
            channelsToSeed.map((channel) => ({
              organizationId: workspaceId,
              ...channel,
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
        createdAt: schema.channels.createdAt,
        updatedAt: schema.channels.updatedAt,
      })
      .from(schema.channels)
      .where(eq(schema.channels.organizationId, workspaceId))
      .orderBy(asc(schema.channels.createdAt), asc(schema.channels.slug))
      .all()
      .then((channels) =>
        channels.map((channel) => ({
          ...channel,
          visibility: channel.slug.startsWith("dm-")
            ? ("direct" as const)
            : channel.slug === "getting-started"
              ? ("private" as const)
              : ("public" as const),
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
    input: { name: string; description?: string },
  ) {
    const name = input.name.trim().slice(0, 60);
    if (!name) throw new Error("Channel name is required.");
    const baseSlug =
      name
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "channel";
    const existing = await this.list(workspaceId);
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
      topic: "",
      description: description ?? `Work and conversation in #${name}`,
      agentIds: ["cmo"],
      visibility: "public",
      createdAt: now,
      updatedAt: now,
    };
    await this.database()
      .insert(schema.channels)
      .values({ organizationId: workspaceId, ...channel })
      .run();
    return channel;
  }

  async update(
    workspaceId: string,
    channelId: string,
    input: { name: string; topic: string; description: string },
  ) {
    const channel = await this.get(workspaceId, channelId);
    if (!channel) throw new Error("Channel was not found in this workspace.");
    if (channel.visibility === "direct") {
      throw new Error("Direct messages cannot be edited as channels.");
    }
    const name = input.name.trim();
    const topic = input.topic.trim();
    const description = input.description.trim();
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
    await this.database()
      .update(schema.channels)
      .set({ name, topic, description, updatedAt })
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          eq(schema.channels.id, channel.id),
        ),
      )
      .run();
    // The stable slug is deliberately retained so existing links keep working.
    return { ...channel, name, topic, description, updatedAt };
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
    const publicChannels = (await this.list(workspaceId)).filter(
      (candidate) => candidate.visibility === "public",
    );
    if (publicChannels.length <= 1) {
      throw new Error("A workspace must keep at least one channel.");
    }
    return channel;
  }

  async remove(workspaceId: string, channelId: string) {
    const channel = await this.assertRemovable(workspaceId, channelId);
    await this.database().transaction(async (tx) => {
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
  ) {
    const channel = await this.get(workspaceId, channelId);
    if (!channel || channel.visibility === "direct" || agentIds.length === 0) {
      return channel;
    }
    const nextAgentIds = [...new Set([...channel.agentIds, ...agentIds])];
    if (nextAgentIds.length === channel.agentIds.length) return channel;
    const updatedAt = Date.now();
    await this.database()
      .update(schema.channels)
      .set({ agentIds: nextAgentIds, updatedAt })
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          eq(schema.channels.id, channel.id),
        ),
      )
      .run();
    return { ...channel, agentIds: nextAgentIds, updatedAt };
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
    await this.database()
      .update(schema.channels)
      .set({ agentIds: nextAgentIds, updatedAt })
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          eq(schema.channels.id, channel.id),
        ),
      )
      .run();
    return { ...channel, agentIds: nextAgentIds, updatedAt };
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
          if (event.kind === 7) {
            return [{ ...event, kind: 7 }];
          }
          if (event.kind === 9) {
            return [
              {
                ...event,
                kind: 9,
                parts: event.parts ?? undefined,
              },
            ];
          }
          return [];
        }),
      );
  }
}
