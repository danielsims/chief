import { randomUUID } from "node:crypto";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, asc, eq } from "drizzle-orm";

import type { ChannelEvent, WorkspaceChannel } from "../types.js";
import * as schema from "../db/schema.js";
import { defaultWorkspaceChannels } from "./nip29.js";

export class ChannelStore {
  constructor(
    private readonly database: () => LibSQLDatabase,
    private readonly ready: Promise<void>,
  ) {}

  async list(workspaceId: string): Promise<WorkspaceChannel[]> {
    await this.ready;
    const db = this.database();
    await db
      .insert(schema.channels)
      .values(
        defaultWorkspaceChannels().map((channel) => ({
          organizationId: workspaceId,
          ...channel,
        })),
      )
      .onConflictDoNothing()
      .run();
    return db
      .select({
        protocol: schema.channels.protocol,
        id: schema.channels.id,
        slug: schema.channels.slug,
        name: schema.channels.name,
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
