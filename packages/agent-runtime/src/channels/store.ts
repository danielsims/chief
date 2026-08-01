import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, asc, eq, or } from "drizzle-orm";

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
      .all();
  }

  async get(workspaceId: string, channelId: string) {
    await this.list(workspaceId);
    return this.database()
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          or(
            eq(schema.channels.id, channelId),
            eq(schema.channels.slug, channelId),
          ),
        ),
      )
      .get();
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
        events.map((event) => ({
          ...event,
          kind: 9 as const,
          parts: event.parts ?? undefined,
        })),
      );
  }
}
