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
import type { Client } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

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
  WorkspaceFileRecord,
  WorkspaceFileSnapshot,
} from "./types.js";
import * as schema from "./db/schema.js";
import { hasPotentialSideEffects } from "./run-safety.js";

const RESTART_RUN_SUMMARY =
  "Chief restarted before this run returned a result. Nothing external was assumed to have completed.";
const RESTART_RUN_ERROR = "The local runtime restarted during this run.";

class RecurringWorkClaimConflict extends Error {}

const moduleDirectory =
  typeof __dirname === "string"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

const CHIEF_DATABASE_PATH = join(homedir(), ".chief", "chief.sqlite");
const LEGACY_DATABASE_PATH = join(homedir(), ".marketer", "marketer.sqlite");
const CHIEF_KEYCHAIN_SERVICE = "com.danielsims.chief.local-database";
const LEGACY_KEYCHAIN_SERVICE = "com.danielsims.marketer.local-database";

function defaultDatabasePath() {
  return (
    process.env.CHIEF_DATABASE_PATH ??
    process.env.MARKETER_DATABASE_PATH ??
    (!existsSync(CHIEF_DATABASE_PATH) && existsSync(LEGACY_DATABASE_PATH)
      ? LEGACY_DATABASE_PATH
      : CHIEF_DATABASE_PATH)
  );
}

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

function isLegacyLauncherError(event: AgentEvent) {
  if (event.type !== "error") return false;
  return (
    event.message === "Codex exited unexpectedly with code 127." ||
    event.message.includes(
      "Failed to spawn Claude Code process: spawn node ENOENT",
    )
  );
}

function durableEvents(events: AgentEvent[]) {
  return events.filter(
    (event) =>
      !isLegacyLauncherError(event) &&
      (event.type === "message" ||
        event.type === "result" ||
        event.type === "error" ||
        event.type === "permissionResolved"),
  );
}

function encryptionKey(directory: string) {
  const configured =
    process.env.CHIEF_DATABASE_ENCRYPTION_KEY ??
    process.env.MARKETER_DATABASE_ENCRYPTION_KEY;
  if (configured) return configured;
  const service = directory.startsWith(join(homedir(), ".marketer"))
    ? LEGACY_KEYCHAIN_SERVICE
    : CHIEF_KEYCHAIN_SERVICE;
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

  constructor(path = defaultDatabasePath()) {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (
      directory.startsWith(join(homedir(), ".chief")) ||
      directory.startsWith(join(homedir(), ".marketer"))
    ) {
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
      await client.execute("PRAGMA busy_timeout = 5000");
      await client.execute("PRAGMA foreign_keys = ON");
      await migrate(db, {
        migrationsFolder: join(moduleDirectory, "..", "drizzle"),
      });
      chmodSync(path, 0o600);
      for (const suffix of ["-wal", "-shm"]) {
        if (existsSync(`${path}${suffix}`))
          chmodSync(`${path}${suffix}`, 0o600);
      }
    })();
  }

  async health() {
    await this.ready;
    await this.client.execute("SELECT 1");
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

  async saveTranscript(
    context: ChatContext,
    events: AgentEvent[],
    titleOverride?: string,
  ) {
    await this.ready;
    const durable = durableEvents(events);
    const texts = userTexts(durable);
    const firstText = texts[0];
    const lastText = texts.at(-1);
    if (!firstText || !lastText) return;
    const now = Date.now();
    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.chats)
        .values({
          id: context.id,
          workspaceId: context.workspaceId,
          agentId: context.agentId,
          title: (titleOverride ?? firstText).slice(0, 72),
          lastText: lastText.slice(0, 200),
          driver: context.driver,
          model: context.model,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
      const updated = await tx
        .update(schema.chats)
        .set({
          agentId: context.agentId,
          ...(titleOverride ? { title: titleOverride.slice(0, 72) } : {}),
          lastText: lastText.slice(0, 200),
          driver: context.driver,
          model: context.model,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.chats.id, context.id),
            eq(schema.chats.workspaceId, context.workspaceId),
          ),
        )
        .run();
      if (updated.rowsAffected === 0) {
        throw new Error("Chat belongs to a different workspace.");
      }
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
    return rows
      .filter((chat) => !chat.id.startsWith("automation-"))
      .map((chat) => ({
        id: chat.id,
        agentId: chat.agentId,
        title: chat.title,
        lastText: chat.lastText,
        lastAt: chat.updatedAt,
        driver: chat.driver,
        model: chat.model ?? undefined,
      }));
  }

  async chat(
    workspaceId: string,
    chatId: string,
  ): Promise<LocalChatSummary | null> {
    await this.ready;
    const chat = await this.db
      .select()
      .from(schema.chats)
      .where(
        and(
          eq(schema.chats.id, chatId),
          eq(schema.chats.workspaceId, workspaceId),
        ),
      )
      .get();
    return chat
      ? {
          id: chat.id,
          agentId: chat.agentId,
          title: chat.title,
          lastText: chat.lastText,
          lastAt: chat.updatedAt,
          driver: chat.driver,
          model: chat.model ?? undefined,
        }
      : null;
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
        const event = JSON.parse(eventJson) as AgentEvent;
        return isLegacyLauncherError(event) ? [] : [event];
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
      fileId: draft.fileId ?? undefined,
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
          fileId: draft.fileId,
          status: draft.status,
          scheduledFor: draft.scheduledFor,
          updatedAt: draft.updatedAt,
        },
      })
      .run();
  }

  async listWorkspaceFiles(
    workspaceId: string,
  ): Promise<WorkspaceFileRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.workspaceFiles)
      .where(eq(schema.workspaceFiles.workspaceId, workspaceId))
      .orderBy(desc(schema.workspaceFiles.updatedAt))
      .all();
    return rows.map((file) => ({
      ...file,
      sourceAgentId: file.sourceAgentId ?? undefined,
      sourceRunId: file.sourceRunId ?? undefined,
    }));
  }

  async workspaceFile(
    workspaceId: string,
    fileId: string,
  ): Promise<WorkspaceFileSnapshot | null> {
    await this.ready;
    const file = await this.db
      .select()
      .from(schema.workspaceFiles)
      .where(
        and(
          eq(schema.workspaceFiles.id, fileId),
          eq(schema.workspaceFiles.workspaceId, workspaceId),
        ),
      )
      .get();
    if (!file) return null;
    const version = await this.db
      .select({ content: schema.workspaceFileVersions.content })
      .from(schema.workspaceFileVersions)
      .where(
        and(
          eq(schema.workspaceFileVersions.id, file.currentVersionId),
          eq(schema.workspaceFileVersions.workspaceId, workspaceId),
        ),
      )
      .get();
    if (!version) throw new Error("The current file revision is unavailable.");
    return {
      ...file,
      sourceAgentId: file.sourceAgentId ?? undefined,
      sourceRunId: file.sourceRunId ?? undefined,
      content: version.content,
    };
  }

  async saveWorkspaceFile(
    workspaceId: string,
    file: WorkspaceFileSnapshot,
    expectedVersionId?: string,
  ) {
    await this.ready;
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({
          workspaceId: schema.workspaceFiles.workspaceId,
          currentVersionId: schema.workspaceFiles.currentVersionId,
        })
        .from(schema.workspaceFiles)
        .where(eq(schema.workspaceFiles.id, file.id))
        .get();
      if (existing && existing.workspaceId !== workspaceId) {
        throw new Error("File belongs to a different workspace.");
      }
      if (
        existing &&
        expectedVersionId &&
        existing.currentVersionId !== expectedVersionId
      ) {
        throw new Error("FILE_VERSION_CONFLICT");
      }
      await tx
        .insert(schema.workspaceFiles)
        .values({
          id: file.id,
          workspaceId,
          name: file.name,
          path: file.path,
          mimeType: file.mimeType,
          kind: file.kind,
          provider: file.provider,
          currentVersionId: file.currentVersionId,
          createdBy: file.createdBy,
          sourceAgentId: file.sourceAgentId,
          sourceRunId: file.sourceRunId,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
        })
        .onConflictDoUpdate({
          target: schema.workspaceFiles.id,
          set: {
            name: file.name,
            path: file.path,
            mimeType: file.mimeType,
            kind: file.kind,
            provider: file.provider,
            currentVersionId: file.currentVersionId,
            sourceAgentId: file.sourceAgentId,
            sourceRunId: file.sourceRunId,
            updatedAt: file.updatedAt,
          },
        })
        .run();
      await tx
        .insert(schema.workspaceFileVersions)
        .values({
          id: file.currentVersionId,
          fileId: file.id,
          workspaceId,
          content: file.content,
          size: Buffer.byteLength(file.content, "utf8"),
          createdBy: file.createdBy,
          sourceAgentId: file.sourceAgentId,
          sourceRunId: file.sourceRunId,
          createdAt: file.updatedAt,
        })
        .run();
    });
  }

  async deleteWorkspaceFile(workspaceId: string, fileId: string) {
    await this.ready;
    await this.db
      .delete(schema.workspaceFiles)
      .where(
        and(
          eq(schema.workspaceFiles.id, fileId),
          eq(schema.workspaceFiles.workspaceId, workspaceId),
        ),
      )
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
      skipDates: work.skipDates ?? undefined,
      runOnceAt: work.runOnceAt ?? undefined,
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
          skipDates: row.skipDates ?? undefined,
          runOnceAt: row.runOnceAt ?? undefined,
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
          runOnceAt: work.runOnceAt ?? null,
          status: work.status,
          placement: work.placement,
          skipDates: work.skipDates ?? null,
          approvalSummary: work.approvalSummary,
          proposedToolPatterns: work.proposedToolPatterns,
          grant: work.grant,
          nextRunAt: work.nextRunAt ?? null,
          lastRunAt: work.lastRunAt,
          lastResult: work.lastResult,
          updatedAt: work.updatedAt,
        },
      })
      .run();
  }

  async deleteRecurringWorkRun(workspaceId: string, runId: string) {
    await this.ready;
    await this.db
      .delete(schema.recurringWorkRuns)
      .where(
        and(
          eq(schema.recurringWorkRuns.id, runId),
          eq(schema.recurringWorkRuns.workspaceId, workspaceId),
        ),
      )
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

  async listAttentionItems(
    workspaceId: string,
  ): Promise<import("./types.js").AttentionItem[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.attentionItems)
      .where(
        and(
          eq(schema.attentionItems.workspaceId, workspaceId),
          eq(schema.attentionItems.status, "open"),
        ),
      )
      .orderBy(desc(schema.attentionItems.createdAt))
      .all();
    return rows.map((item) => ({
      id: item.id,
      agentId: item.agentId,
      title: item.title,
      reason: item.reason,
      sourceId: item.sourceId ?? undefined,
      status: item.status,
      createdAt: item.createdAt,
    }));
  }

  async raiseAttentionItem(
    workspaceId: string,
    item: import("./types.js").AttentionItem,
  ) {
    await this.ready;
    await this.db
      .insert(schema.attentionItems)
      .values({ ...item, sourceId: item.sourceId ?? null, workspaceId })
      .onConflictDoUpdate({
        target: schema.attentionItems.id,
        set: {
          agentId: item.agentId,
          title: item.title,
          reason: item.reason,
          sourceId: item.sourceId ?? null,
          status: item.status,
          createdAt: item.createdAt,
        },
      })
      .run();
  }

  async dismissAttentionItem(workspaceId: string, id: string) {
    await this.ready;
    await this.db
      .update(schema.attentionItems)
      .set({ status: "dismissed" })
      .where(
        and(
          eq(schema.attentionItems.id, id),
          eq(schema.attentionItems.workspaceId, workspaceId),
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
    nextRunAt: number | null,
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
        artifacts: schema.recurringWorkRuns.artifacts,
        blockedTools: schema.recurringWorkRuns.blockedTools,
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
          artifacts: run.artifacts ?? undefined,
          blockedTools: run.blockedTools ?? undefined,
        })),
      );
  }

  /**
   * A process exit cannot leave a real agent running. The sole runtime process
   * calls this after it owns the port, so every pre-existing running record is
   * interrupted and must be closed before new work is dispatched.
   */
  async reconcileInterruptedRecurringWorkRuns(cutoff: number) {
    await this.ready;
    const interrupted = await this.db
      .select()
      .from(schema.recurringWorkRuns)
      .where(
        and(
          eq(schema.recurringWorkRuns.status, "running"),
          lte(schema.recurringWorkRuns.startedAt, cutoff),
        ),
      )
      .all();
    for (const run of interrupted) {
      await this.db.transaction(async (tx) => {
        const transcriptRows = await tx
          .select({ eventJson: schema.chatEvents.eventJson })
          .from(schema.chatEvents)
          .where(eq(schema.chatEvents.chatId, `automation-run-${run.id}`))
          .all();
        const touchedTools = hasPotentialSideEffects(
          transcriptRows.flatMap(({ eventJson }) => {
            try {
              return [JSON.parse(eventJson) as AgentEvent];
            } catch {
              return [];
            }
          }),
        );
        const closed = await tx
          .update(schema.recurringWorkRuns)
          .set({
            status: "failed",
            finishedAt: Date.now(),
            summary: RESTART_RUN_SUMMARY,
            error: RESTART_RUN_ERROR,
          })
          .where(
            and(
              eq(schema.recurringWorkRuns.id, run.id),
              eq(schema.recurringWorkRuns.status, "running"),
            ),
          )
          .run();
        if (closed.rowsAffected === 0) return;

        const work = await tx
          .select({
            status: schema.recurringWork.status,
          })
          .from(schema.recurringWork)
          .where(
            and(
              eq(schema.recurringWork.id, run.recurringWorkId),
              eq(schema.recurringWork.workspaceId, run.workspaceId),
            ),
          )
          .get();
        if (work?.status !== "active") return;
        await tx
          .update(schema.recurringWork)
          .set({
            status: "needs_approval",
            nextRunAt: null,
            lastResult: touchedTools
              ? "Chief restarted after this run used tools. It will not retry automatically."
              : "Chief restarted before this run returned a result. Review it before trying again.",
            updatedAt: Date.now(),
          })
          .where(eq(schema.recurringWork.id, run.recurringWorkId))
          .run();
      });
    }
    return { interrupted: interrupted.length, requeued: 0 };
  }

  /** Union of Executor addresses recent runs of this automation declined. */
  async latestRunBlockedTools(
    workspaceId: string,
    recurringWorkId: string,
  ): Promise<string[]> {
    await this.ready;
    const rows = await this.db
      .select({ blockedTools: schema.recurringWorkRuns.blockedTools })
      .from(schema.recurringWorkRuns)
      .where(
        and(
          eq(schema.recurringWorkRuns.workspaceId, workspaceId),
          eq(schema.recurringWorkRuns.recurringWorkId, recurringWorkId),
        ),
      )
      .orderBy(desc(schema.recurringWorkRuns.startedAt))
      .limit(10)
      .all();
    return [...new Set(rows.flatMap((row) => row.blockedTools ?? []))];
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
          blockedTools: run.blockedTools ?? null,
          summary: run.summary,
          error: run.error,
          artifacts: run.artifacts ?? null,
        },
      })
      .run();
  }

  async startRecurringWorkRun(
    workspaceId: string,
    run: RecurringWorkRunRecord,
    transition?: {
      expectedNextRunAt?: number;
      nextRunAt: number | null;
    },
  ) {
    await this.ready;
    try {
      return await this.db.transaction(async (tx) => {
        if (transition) {
          const conditions = [
            eq(schema.recurringWork.id, run.recurringWorkId),
            eq(schema.recurringWork.workspaceId, workspaceId),
          ];
          if (transition.expectedNextRunAt !== undefined) {
            conditions.push(
              eq(schema.recurringWork.nextRunAt, transition.expectedNextRunAt),
              eq(schema.recurringWork.status, "active"),
              eq(schema.recurringWork.placement, "local"),
              isNotNull(schema.recurringWork.grant),
            );
          }
          const claimed = await tx
            .update(schema.recurringWork)
            .set({
              nextRunAt: transition.nextRunAt,
              updatedAt: Date.now(),
            })
            .where(and(...conditions))
            .run();
          if (claimed.rowsAffected === 0) {
            throw new RecurringWorkClaimConflict();
          }
        }
        const started = await tx
          .insert(schema.recurringWorkRuns)
          .values({ ...run, workspaceId })
          .onConflictDoNothing()
          .run();
        if (started.rowsAffected === 0) {
          throw new RecurringWorkClaimConflict();
        }
        return true;
      });
    } catch (error) {
      if (error instanceof RecurringWorkClaimConflict) return false;
      throw error;
    }
  }

  async finishRecurringWorkRun(
    workspaceId: string,
    run: RecurringWorkRunRecord,
    work: RecurringWorkRecord,
  ) {
    await this.ready;
    await this.db.transaction(async (tx) => {
      const finished = await tx
        .update(schema.recurringWorkRuns)
        .set({
          status: run.status,
          finishedAt: run.finishedAt,
          blockedTools: run.blockedTools ?? null,
          summary: run.summary,
          error: run.error,
          artifacts: run.artifacts ?? null,
        })
        .where(
          and(
            eq(schema.recurringWorkRuns.id, run.id),
            eq(schema.recurringWorkRuns.workspaceId, workspaceId),
          ),
        )
        .run();
      if (finished.rowsAffected === 0) {
        throw new Error("The active recurring work run was not found.");
      }
      const currentWork = await tx
        .select({
          status: schema.recurringWork.status,
          grant: schema.recurringWork.grant,
          nextRunAt: schema.recurringWork.nextRunAt,
        })
        .from(schema.recurringWork)
        .where(
          and(
            eq(schema.recurringWork.id, work.id),
            eq(schema.recurringWork.workspaceId, workspaceId),
          ),
        )
        .get();
      if (!currentWork) {
        throw new Error("The recurring work definition was not found.");
      }
      const userStoppedWork =
        currentWork.status === "paused" || currentWork.grant === null;
      const saved = await tx
        .update(schema.recurringWork)
        .set({
          status: userStoppedWork ? currentWork.status : work.status,
          nextRunAt: userStoppedWork
            ? currentWork.nextRunAt
            : (work.nextRunAt ?? null),
          lastRunAt: work.lastRunAt,
          lastResult: work.lastResult,
          updatedAt: work.updatedAt,
        })
        .where(
          and(
            eq(schema.recurringWork.id, work.id),
            eq(schema.recurringWork.workspaceId, workspaceId),
          ),
        )
        .run();
      if (saved.rowsAffected === 0)
        throw new Error("Recurring work was not saved.");
    });
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
