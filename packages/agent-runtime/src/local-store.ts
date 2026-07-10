import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, type Client } from "@libsql/client";
import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import * as schema from "./db/schema.js";
import type {
  AgentEvent,
  AgentPreference,
  CampaignRecord,
  ContentDraftRecord,
  DriverType,
  ProspectRecord,
  RecurringWorkRecord,
  RecurringWorkRunRecord,
  TrendRecord,
} from "./types.js";

export interface LocalChatSummary {
  id: string;
  agentId: string;
  title: string;
  lastText: string;
  lastAt: number;
  driver?: DriverType;
  model?: string;
}

interface ChatContext {
  id: string;
  workspaceId: string;
  agentId: string;
  driver: DriverType;
  model?: string;
}

function userTexts(events: AgentEvent[]) {
  const texts: string[] = [];
  for (const event of events) {
    if (event.type !== "message" || event.role !== "user") continue;
    const text = event.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (text) texts.push(text);
  }
  return texts;
}

function durableEvents(events: AgentEvent[]) {
  return events.filter(
    (event) =>
      event.type === "message" ||
      event.type === "result" ||
      event.type === "error" ||
      event.type === "permissionResolved",
  );
}

function encryptionKey(directory: string) {
  const configured = process.env.MARKETER_DATABASE_ENCRYPTION_KEY;
  if (configured) return configured;
  const service = "com.danielsims.marketer.local-database";
  const account = "default";
  if (process.platform === "darwin") {
    try {
      return execFileSync(
        "/usr/bin/security",
        ["find-generic-password", "-s", service, "-a", account, "-w"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch {
      const key = randomBytes(32).toString("base64url");
      execFileSync(
        "/usr/bin/security",
        ["add-generic-password", "-U", "-s", service, "-a", account, "-w", key],
        { stdio: "ignore" },
      );
      return key;
    }
  }
  const path = join(directory, ".database-key");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const key = randomBytes(32).toString("base64url");
  writeFileSync(path, key, { mode: 0o600 });
  return key;
}

export class LocalStore {
  private readonly client: Client;
  private readonly db: LibSQLDatabase;
  private readonly ready: Promise<void>;

  constructor(
    path = process.env.MARKETER_DATABASE_PATH ??
      join(homedir(), ".marketer", "marketer.sqlite"),
  ) {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (directory.startsWith(join(homedir(), ".marketer"))) {
      chmodSync(directory, 0o700);
    }
    const client = createClient({
      url: `file:${path}`,
      encryptionKey: encryptionKey(directory),
      timeout: 5_000,
    });
    const db = drizzle({ client });
    this.client = client;
    this.db = db;
    this.ready = (async () => {
      await client.execute("PRAGMA journal_mode = WAL");
      await client.execute("PRAGMA foreign_keys = ON");
      await migrate(db, {
        migrationsFolder: join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "drizzle",
        ),
      });
      chmodSync(path, 0o600);
      for (const suffix of ["-wal", "-shm"]) {
        if (existsSync(`${path}${suffix}`))
          chmodSync(`${path}${suffix}`, 0o600);
      }
    })();
  }

  async hasChat(chatId: string) {
    await this.ready;
    return Boolean(
      await this.db
        .select({ id: schema.chats.id })
        .from(schema.chats)
        .where(eq(schema.chats.id, chatId))
        .get(),
    );
  }

  async saveTranscript(context: ChatContext, events: AgentEvent[]) {
    await this.ready;
    const durable = durableEvents(events);
    const texts = userTexts(durable);
    const firstText = texts[0];
    const lastText = texts.at(-1);
    if (!firstText || !lastText) return;
    const now = Date.now();
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ workspaceId: schema.chats.workspaceId })
        .from(schema.chats)
        .where(eq(schema.chats.id, context.id))
        .get();
      if (existing && existing.workspaceId !== context.workspaceId) {
        throw new Error("Chat belongs to a different workspace.");
      }
      await tx
        .insert(schema.chats)
        .values({
          id: context.id,
          workspaceId: context.workspaceId,
          agentId: context.agentId,
          title: firstText.slice(0, 72),
          lastText: lastText.slice(0, 200),
          driver: context.driver,
          model: context.model,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.chats.id,
          set: {
            workspaceId: context.workspaceId,
            agentId: context.agentId,
            lastText: lastText.slice(0, 200),
            driver: context.driver,
            model: context.model,
            updatedAt: now,
          },
        })
        .run();
      await tx
        .delete(schema.chatEvents)
        .where(eq(schema.chatEvents.chatId, context.id))
        .run();
      if (durable.length > 0) {
        await tx
          .insert(schema.chatEvents)
          .values(
            durable.map((event, position) => ({
              chatId: context.id,
              position,
              eventJson: JSON.stringify(event),
            })),
          )
          .run();
      }
    });
  }

  async listChats(workspaceId: string): Promise<LocalChatSummary[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.chats)
      .where(eq(schema.chats.workspaceId, workspaceId))
      .orderBy(desc(schema.chats.updatedAt))
      .all();
    return rows.map((chat) => ({
      id: chat.id,
      agentId: chat.agentId,
      title: chat.title,
      lastText: chat.lastText,
      lastAt: chat.updatedAt,
      driver: chat.driver,
      model: chat.model ?? undefined,
    }));
  }

  async transcript(workspaceId: string, chatId: string): Promise<AgentEvent[]> {
    await this.ready;
    const chat = await this.db
      .select({ id: schema.chats.id })
      .from(schema.chats)
      .where(
        and(
          eq(schema.chats.id, chatId),
          eq(schema.chats.workspaceId, workspaceId),
        ),
      )
      .get();
    if (!chat) return [];
    const rows = await this.db
      .select({ eventJson: schema.chatEvents.eventJson })
      .from(schema.chatEvents)
      .where(eq(schema.chatEvents.chatId, chatId))
      .orderBy(schema.chatEvents.position)
      .all();
    return rows.flatMap(({ eventJson }) => {
      try {
        return [JSON.parse(eventJson) as AgentEvent];
      } catch {
        return [];
      }
    });
  }

  async deleteChat(workspaceId: string, chatId: string) {
    await this.ready;
    await this.db
      .delete(schema.chats)
      .where(
        and(
          eq(schema.chats.id, chatId),
          eq(schema.chats.workspaceId, workspaceId),
        ),
      )
      .run();
  }

  async updateChatPreferences(
    workspaceId: string,
    chatId: string,
    driver: DriverType,
    model?: string,
  ) {
    await this.ready;
    await this.db
      .update(schema.chats)
      .set({ driver, model: model || null, updatedAt: Date.now() })
      .where(
        and(
          eq(schema.chats.id, chatId),
          eq(schema.chats.workspaceId, workspaceId),
        ),
      )
      .run();
  }

  async listProspects(workspaceId: string): Promise<ProspectRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.workspaceId, workspaceId))
      .orderBy(desc(schema.prospects.foundAt))
      .all();
    return rows.map((prospect) => ({
      id: prospect.id,
      name: prospect.name,
      company: prospect.company ?? undefined,
      source: prospect.source,
      sourceUrl: prospect.sourceUrl ?? undefined,
      summary: prospect.summary,
      relevance: prospect.relevance,
      status: prospect.status,
      foundAt: prospect.foundAt,
    }));
  }

  async saveProspect(workspaceId: string, prospect: ProspectRecord) {
    await this.ready;
    const existing = await this.db
      .select({ workspaceId: schema.prospects.workspaceId })
      .from(schema.prospects)
      .where(eq(schema.prospects.id, prospect.id))
      .get();
    if (existing && existing.workspaceId !== workspaceId) {
      throw new Error("Prospect belongs to a different workspace.");
    }
    await this.db
      .insert(schema.prospects)
      .values({ ...prospect, workspaceId, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: schema.prospects.id,
        set: {
          name: prospect.name,
          company: prospect.company,
          source: prospect.source,
          sourceUrl: prospect.sourceUrl,
          summary: prospect.summary,
          relevance: prospect.relevance,
          status: prospect.status,
          foundAt: prospect.foundAt,
          updatedAt: Date.now(),
        },
      })
      .run();
  }

  async listTrends(workspaceId: string): Promise<TrendRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.trends)
      .where(eq(schema.trends.workspaceId, workspaceId))
      .orderBy(desc(schema.trends.foundAt))
      .all();
    return rows.map((trend) => ({
      id: trend.id,
      title: trend.title,
      source: trend.source,
      sourceUrl: trend.sourceUrl ?? undefined,
      summary: trend.summary,
      signal: trend.signal,
      status: trend.status,
      foundAt: trend.foundAt,
    }));
  }

  async saveTrend(workspaceId: string, trend: TrendRecord) {
    await this.ready;
    const existing = await this.db
      .select({ workspaceId: schema.trends.workspaceId })
      .from(schema.trends)
      .where(eq(schema.trends.id, trend.id))
      .get();
    if (existing && existing.workspaceId !== workspaceId) {
      throw new Error("Trend belongs to a different workspace.");
    }
    await this.db
      .insert(schema.trends)
      .values({ ...trend, workspaceId, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: schema.trends.id,
        set: {
          title: trend.title,
          source: trend.source,
          sourceUrl: trend.sourceUrl,
          summary: trend.summary,
          signal: trend.signal,
          status: trend.status,
          foundAt: trend.foundAt,
          updatedAt: Date.now(),
        },
      })
      .run();
  }

  async listDrafts(workspaceId: string): Promise<ContentDraftRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.contentDrafts)
      .where(eq(schema.contentDrafts.workspaceId, workspaceId))
      .orderBy(desc(schema.contentDrafts.updatedAt))
      .all();
    return rows.map((draft) => ({
      id: draft.id,
      agentId: draft.agentId,
      title: draft.title,
      body: draft.body,
      platform: draft.platform,
      status: draft.status,
      scheduledFor: draft.scheduledFor ?? undefined,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    }));
  }

  async saveDraft(workspaceId: string, draft: ContentDraftRecord) {
    await this.ready;
    const existing = await this.db
      .select({ workspaceId: schema.contentDrafts.workspaceId })
      .from(schema.contentDrafts)
      .where(eq(schema.contentDrafts.id, draft.id))
      .get();
    if (existing && existing.workspaceId !== workspaceId) {
      throw new Error("Content draft belongs to a different workspace.");
    }
    await this.db
      .insert(schema.contentDrafts)
      .values({ ...draft, workspaceId })
      .onConflictDoUpdate({
        target: schema.contentDrafts.id,
        set: {
          agentId: draft.agentId,
          title: draft.title,
          body: draft.body,
          platform: draft.platform,
          status: draft.status,
          scheduledFor: draft.scheduledFor,
          updatedAt: draft.updatedAt,
        },
      })
      .run();
  }

  async listRecurringWork(workspaceId: string): Promise<RecurringWorkRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.recurringWork)
      .where(eq(schema.recurringWork.workspaceId, workspaceId))
      .orderBy(schema.recurringWork.nextRunAt)
      .all();
    return rows.map((work) => ({
      ...work,
      grant: work.grant ?? undefined,
      nextRunAt: work.nextRunAt ?? undefined,
      lastRunAt: work.lastRunAt ?? undefined,
      lastResult: work.lastResult ?? undefined,
    }));
  }

  async recurringWorkById(workspaceId: string, id: string) {
    await this.ready;
    const row = await this.db
      .select()
      .from(schema.recurringWork)
      .where(
        and(
          eq(schema.recurringWork.id, id),
          eq(schema.recurringWork.workspaceId, workspaceId),
        ),
      )
      .get();
    return row
      ? ({
          ...row,
          grant: row.grant ?? undefined,
          nextRunAt: row.nextRunAt ?? undefined,
          lastRunAt: row.lastRunAt ?? undefined,
          lastResult: row.lastResult ?? undefined,
        } satisfies RecurringWorkRecord)
      : undefined;
  }

  async saveRecurringWork(workspaceId: string, work: RecurringWorkRecord) {
    await this.ready;
    const { upcomingRuns: _upcomingRuns, ...persisted } = work;
    const existing = await this.db
      .select({ workspaceId: schema.recurringWork.workspaceId })
      .from(schema.recurringWork)
      .where(eq(schema.recurringWork.id, work.id))
      .get();
    if (existing && existing.workspaceId !== workspaceId) {
      throw new Error("Recurring work belongs to a different workspace.");
    }
    await this.db
      .insert(schema.recurringWork)
      .values({ ...persisted, workspaceId })
      .onConflictDoUpdate({
        target: schema.recurringWork.id,
        set: {
          agentId: work.agentId,
          title: work.title,
          instructions: work.instructions,
          cron: work.cron,
          timezone: work.timezone,
          status: work.status,
          placement: work.placement,
          approvalSummary: work.approvalSummary,
          proposedToolPatterns: work.proposedToolPatterns,
          grant: work.grant,
          nextRunAt: work.nextRunAt,
          lastRunAt: work.lastRunAt,
          lastResult: work.lastResult,
          updatedAt: work.updatedAt,
        },
      })
      .run();
  }

  async deleteRecurringWork(workspaceId: string, id: string) {
    await this.ready;
    await this.db
      .delete(schema.recurringWorkRuns)
      .where(
        and(
          eq(schema.recurringWorkRuns.recurringWorkId, id),
          eq(schema.recurringWorkRuns.workspaceId, workspaceId),
        ),
      )
      .run();
    await this.db
      .delete(schema.recurringWork)
      .where(
        and(
          eq(schema.recurringWork.id, id),
          eq(schema.recurringWork.workspaceId, workspaceId),
        ),
      )
      .run();
  }

  async dueRecurringWork(now: number) {
    await this.ready;
    return this.db
      .select()
      .from(schema.recurringWork)
      .where(
        and(
          eq(schema.recurringWork.status, "active"),
          // Cloud-placed automations fire in the deployment, never here.
          eq(schema.recurringWork.placement, "local"),
          lte(schema.recurringWork.nextRunAt, now),
          // An active row without a grant can never run; returning it would
          // make every tick fetch and skip it forever.
          isNotNull(schema.recurringWork.grant),
        ),
      )
      .all();
  }

  /**
   * Atomically claims a due run by advancing nextRunAt only if it still holds
   * the expected due time. Exactly one process wins when several runtimes
   * poll the same database.
   */
  async claimRecurringWork(
    workspaceId: string,
    id: string,
    expectedNextRunAt: number,
    nextRunAt: number,
  ): Promise<boolean> {
    await this.ready;
    const result = await this.db
      .update(schema.recurringWork)
      .set({ nextRunAt, updatedAt: Date.now() })
      .where(
        and(
          eq(schema.recurringWork.id, id),
          eq(schema.recurringWork.workspaceId, workspaceId),
          eq(schema.recurringWork.nextRunAt, expectedNextRunAt),
        ),
      )
      .run();
    return result.rowsAffected > 0;
  }

  async listRecurringWorkRuns(
    workspaceId: string,
  ): Promise<RecurringWorkRunRecord[]> {
    await this.ready;
    return this.db
      .select({
        id: schema.recurringWorkRuns.id,
        recurringWorkId: schema.recurringWorkRuns.recurringWorkId,
        status: schema.recurringWorkRuns.status,
        scheduledFor: schema.recurringWorkRuns.scheduledFor,
        startedAt: schema.recurringWorkRuns.startedAt,
        finishedAt: schema.recurringWorkRuns.finishedAt,
        summary: schema.recurringWorkRuns.summary,
        error: schema.recurringWorkRuns.error,
      })
      .from(schema.recurringWorkRuns)
      .where(eq(schema.recurringWorkRuns.workspaceId, workspaceId))
      .orderBy(desc(schema.recurringWorkRuns.startedAt))
      .limit(100)
      .all()
      .then((rows) =>
        rows.map((run) => ({
          ...run,
          finishedAt: run.finishedAt ?? undefined,
          summary: run.summary ?? undefined,
          error: run.error ?? undefined,
        })),
      );
  }

  async saveRecurringWorkRun(workspaceId: string, run: RecurringWorkRunRecord) {
    await this.ready;
    await this.db
      .insert(schema.recurringWorkRuns)
      .values({ ...run, workspaceId })
      .onConflictDoUpdate({
        target: schema.recurringWorkRuns.id,
        set: {
          status: run.status,
          finishedAt: run.finishedAt,
          summary: run.summary,
          error: run.error,
        },
      })
      .run();
  }

  async listCampaigns(workspaceId: string): Promise<CampaignRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.workspaceId, workspaceId))
      .orderBy(desc(schema.campaigns.updatedAt))
      .all();
    return rows.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      provider: campaign.provider,
      objective: campaign.objective ?? undefined,
      status: campaign.status,
      currency: campaign.currency,
      budget: campaign.budget ?? undefined,
      spend: campaign.spend ?? undefined,
      revenue: campaign.revenue ?? undefined,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    }));
  }

  async saveCampaign(workspaceId: string, campaign: CampaignRecord) {
    await this.ready;
    const existing = await this.db
      .select({ workspaceId: schema.campaigns.workspaceId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .get();
    if (existing && existing.workspaceId !== workspaceId) {
      throw new Error("Campaign belongs to a different workspace.");
    }
    await this.db
      .insert(schema.campaigns)
      .values({ ...campaign, workspaceId })
      .onConflictDoUpdate({
        target: schema.campaigns.id,
        set: {
          name: campaign.name,
          provider: campaign.provider,
          objective: campaign.objective,
          status: campaign.status,
          currency: campaign.currency,
          budget: campaign.budget,
          spend: campaign.spend,
          revenue: campaign.revenue,
          updatedAt: campaign.updatedAt,
        },
      })
      .run();
  }

  async listAgentPreferences(workspaceId: string): Promise<AgentPreference[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.agentPreferences)
      .where(eq(schema.agentPreferences.workspaceId, workspaceId))
      .orderBy(schema.agentPreferences.agentId)
      .all();
    return rows.map((preference) => ({
      agentId: preference.agentId,
      enabled: preference.enabled,
      driver: preference.driver ?? undefined,
      model: preference.model ?? undefined,
      capabilities: preference.capabilities as
        AgentPreference["capabilities"] | undefined,
      integrations: preference.integrations ?? undefined,
    }));
  }

  async agentPreference(workspaceId: string, agentId: string) {
    const preferences = await this.listAgentPreferences(workspaceId);
    return preferences.find((preference) => preference.agentId === agentId);
  }

  async saveAgentPreference(workspaceId: string, preference: AgentPreference) {
    await this.ready;
    await this.db
      .insert(schema.agentPreferences)
      .values({
        workspaceId,
        agentId: preference.agentId,
        enabled: preference.enabled,
        driver: preference.driver,
        model: preference.model,
        capabilities: preference.capabilities,
        integrations: preference.integrations,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [
          schema.agentPreferences.workspaceId,
          schema.agentPreferences.agentId,
        ],
        set: {
          enabled: preference.enabled,
          driver: preference.driver,
          model: preference.model,
          capabilities: preference.capabilities,
          integrations: preference.integrations,
          updatedAt: Date.now(),
        },
      })
      .run();
  }

  async close() {
    await this.ready;
    this.client.close();
  }
}
