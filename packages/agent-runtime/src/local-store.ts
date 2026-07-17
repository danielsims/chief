import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
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
import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  notExists,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import type {
  AgentEvent,
  AgentPreference,
  AttentionItem,
  CampaignRecord,
  ChiefMessageEventMetadata,
  ChiefUIMessage,
  ContentBlock,
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
const CHIEF_KEYCHAIN_SERVICE = "com.danielsims.chief.local-database";

function defaultDatabasePath() {
  return process.env.CHIEF_DATABASE_PATH ?? CHIEF_DATABASE_PATH;
}

function migrationFolder() {
  return join(moduleDirectory, "..", "drizzle");
}

export interface LocalChatSummary {
  id: string;
  title: string;
  lastText: string;
  lastAt: number;
  driver?: DriverType;
  model?: string;
}

export type ChatVisibility = "user" | "private";
export type ChatStatus = "idle" | "running" | "waiting" | "completed" | "error";

export interface LocalChatRecord {
  id: string;
  workspaceId: string;
  parentId?: string;
  triggerId?: string;
  visibility: ChatVisibility;
  agent: string;
  title: string;
  lastText: string;
  provider: string;
  model?: string;
  providerState?: unknown;
  eveState?: unknown;
  status: ChatStatus;
  createdAt: number;
  updatedAt: number;
}

export type AgentMessageMetadata = ChiefMessageEventMetadata;

export interface LocalMessage<Metadata = AgentMessageMetadata> {
  id: string;
  chatId: string;
  role: "system" | "user" | "assistant";
  parts: unknown[];
  metadata?: Metadata;
  position: number;
  createdAt: number;
}

export interface ChatContext {
  id: string;
  workspaceId: string;
  agentId: string;
  driver: DriverType;
  model?: string;
  parentId?: string;
  triggerId?: string;
  visibility?: ChatVisibility;
  providerState?: unknown;
  eveState?: unknown;
  status?: ChatStatus;
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

function eventMessage(event: AgentEvent) {
  if (event.type === "message") {
    return { role: event.role, parts: event.content } as const;
  }
  if (
    event.type === "result" ||
    event.type === "error" ||
    event.type === "permissionResolved"
  ) {
    return {
      role: "assistant" as const,
      parts: [],
      metadata: event satisfies AgentMessageMetadata,
    };
  }
  return undefined;
}

function uiParts(blocks: ContentBlock[]): ChiefUIMessage["parts"] {
  return blocks.map((block): ChiefUIMessage["parts"][number] => {
    switch (block.type) {
      case "thinking":
        return { type: "reasoning", text: block.thinking };
      case "tool_use":
        return {
          type: "dynamic-tool",
          toolName: block.name,
          toolCallId: block.id,
          state: "input-available",
          input: block.input,
        };
      case "tool_result":
        return {
          type: "dynamic-tool",
          toolName: "tool",
          toolCallId: block.tool_use_id,
          state: block.is_error ? "output-error" : "output-available",
          input: undefined,
          ...(block.is_error
            ? { errorText: String(block.content) }
            : { output: block.content }),
        } as ChiefUIMessage["parts"][number];
      default:
        return block;
    }
  });
}

function contentBlocks(parts: ChiefUIMessage["parts"]): ContentBlock[] {
  return parts.flatMap((part): ContentBlock[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type === "reasoning") {
      return [{ type: "thinking", thinking: part.text }];
    }
    if (part.type === "dynamic-tool") {
      const use: ContentBlock = {
        type: "tool_use",
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
      };
      if (part.state === "output-available") {
        return [
          use,
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: part.output,
          },
        ];
      }
      if (part.state === "output-error") {
        return [
          use,
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: part.errorText,
            is_error: true,
          },
        ];
      }
      return [use];
    }
    if (
      part.type === "data-chart" ||
      part.type === "data-table" ||
      part.type === "data-document"
    ) {
      return [part];
    }
    return [];
  });
}

function uiEventMessages(events: AgentEvent[]) {
  const messages: {
    sourceId?: string;
    role: "user" | "assistant";
    parts: ChiefUIMessage["parts"];
    metadata?: AgentMessageMetadata;
  }[] = [];
  for (const event of events) {
    const converted = eventMessage(event);
    if (!converted) continue;
    if (event.type !== "message") {
      messages.push({
        role: converted.role,
        parts: [],
        metadata: converted.metadata,
      });
      continue;
    }

    const remaining = event.content.filter((block) => {
      if (block.type !== "tool_result") return true;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const prior = messages[index];
        if (prior?.role !== "assistant") continue;
        const partIndex = prior.parts.findIndex(
          (part) =>
            part.type === "dynamic-tool" &&
            part.toolCallId === block.tool_use_id,
        );
        if (partIndex < 0) continue;
        const part = prior.parts[partIndex];
        if (part?.type !== "dynamic-tool") return false;
        prior.parts = prior.parts.map((candidate, candidateIndex) =>
          candidateIndex === partIndex
            ? block.is_error
              ? {
                  ...part,
                  state: "output-error" as const,
                  input: part.input,
                  errorText: String(block.content),
                }
              : {
                  ...part,
                  state: "output-available" as const,
                  input: part.input,
                  output: block.content,
                }
            : candidate,
        ) as ChiefUIMessage["parts"];
        return false;
      }
      return true;
    });
    if (remaining.length === 0) continue;
    messages.push({
      sourceId: event.id,
      role: event.role,
      parts: uiParts(remaining),
    });
  }
  return messages;
}

function agentEvent(message: LocalMessage): AgentEvent | undefined {
  if (message.metadata) return message.metadata;
  if (message.role === "system") return undefined;
  return {
    type: "message",
    id: message.id,
    role: message.role,
    content: contentBlocks(message.parts as ChiefUIMessage["parts"]),
  };
}

function eventKey(message: {
  role: string;
  parts: unknown[];
  metadata?: unknown;
}) {
  return JSON.stringify([
    message.role,
    message.parts,
    message.metadata ?? null,
  ]);
}

function transcriptStatus(events: AgentEvent[]): ChatStatus {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!event) continue;
    if (event.type === "error") return "error";
    if (event.type === "result") return event.ok ? "completed" : "error";
    if (event.type === "status") return event.status;
  }
  return "idle";
}

function driver(provider: string): DriverType | undefined {
  return provider === "claude" ||
    provider === "codex" ||
    provider === "opencode"
    ? provider
    : undefined;
}

function encryptionKey(directory: string) {
  const configured = process.env.CHIEF_DATABASE_ENCRYPTION_KEY;
  if (configured) return configured;
  const account = "default";
  if (process.platform === "darwin") {
    try {
      return execFileSync(
        "/usr/bin/security",
        [
          "find-generic-password",
          "-s",
          CHIEF_KEYCHAIN_SERVICE,
          "-a",
          account,
          "-w",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch {
      const key = randomBytes(32).toString("base64url");
      execFileSync(
        "/usr/bin/security",
        [
          "add-generic-password",
          "-U",
          "-s",
          CHIEF_KEYCHAIN_SERVICE,
          "-a",
          account,
          "-w",
          key,
        ],
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
    if (directory.startsWith(join(homedir(), ".chief"))) {
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
        migrationsFolder: migrationFolder(),
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

  async createChat(
    chat: Omit<
      LocalChatRecord,
      "title" | "lastText" | "status" | "createdAt" | "updatedAt"
    > &
      Partial<
        Pick<
          LocalChatRecord,
          "title" | "lastText" | "status" | "createdAt" | "updatedAt"
        >
      >,
  ) {
    await this.ready;
    const now = Date.now();
    if (chat.parentId) {
      const parent = await this.db
        .select({ workspaceId: schema.chats.workspaceId })
        .from(schema.chats)
        .where(eq(schema.chats.id, chat.parentId))
        .get();
      if (parent?.workspaceId !== chat.workspaceId) {
        throw new Error("Parent chat belongs to a different workspace.");
      }
      if (chat.visibility !== "private") {
        throw new Error("Child chats must be private.");
      }
    }
    await this.db
      .insert(schema.chats)
      .values({
        id: chat.id,
        workspaceId: chat.workspaceId,
        parentId: chat.parentId,
        triggerId: chat.triggerId,
        visibility: chat.visibility,
        agent: chat.agent,
        title: chat.title ?? "",
        lastText: chat.lastText ?? "",
        provider: chat.provider,
        model: chat.model,
        providerState: chat.providerState,
        eveState: chat.eveState,
        status: chat.status ?? "idle",
        createdAt: chat.createdAt ?? now,
        updatedAt: chat.updatedAt ?? now,
      })
      .run();
  }

  async chatRecord(
    workspaceId: string,
    chatId: string,
  ): Promise<LocalChatRecord | null> {
    await this.ready;
    const row = await this.db
      .select()
      .from(schema.chats)
      .where(
        and(
          eq(schema.chats.id, chatId),
          eq(schema.chats.workspaceId, workspaceId),
        ),
      )
      .get();
    return row
      ? {
          ...row,
          parentId: row.parentId ?? undefined,
          triggerId: row.triggerId ?? undefined,
          model: row.model ?? undefined,
          providerState: row.providerState ?? undefined,
          eveState: row.eveState ?? undefined,
        }
      : null;
  }

  async listChildChats(workspaceId: string, parentId: string) {
    await this.ready;
    const rows = await this.db
      .select({ id: schema.chats.id })
      .from(schema.chats)
      .where(
        and(
          eq(schema.chats.workspaceId, workspaceId),
          eq(schema.chats.parentId, parentId),
          eq(schema.chats.visibility, "private"),
        ),
      )
      .orderBy(schema.chats.createdAt)
      .all();
    const chats = await Promise.all(
      rows.map((row) => this.chatRecord(workspaceId, row.id)),
    );
    return chats.filter((chat): chat is LocalChatRecord => chat !== null);
  }

  async updateChatState(
    workspaceId: string,
    chatId: string,
    state: {
      providerState?: unknown;
      eveState?: unknown;
      status?: ChatStatus;
    },
  ) {
    await this.ready;
    const updated = await this.db
      .update(schema.chats)
      .set({ ...state, updatedAt: Date.now() })
      .where(
        and(
          eq(schema.chats.id, chatId),
          eq(schema.chats.workspaceId, workspaceId),
        ),
      )
      .run();
    return updated.rowsAffected > 0;
  }

  async messages<Metadata = AgentMessageMetadata>(
    workspaceId: string,
    chatId: string,
  ): Promise<LocalMessage<Metadata>[]> {
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
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.chatId, chatId))
      .orderBy(schema.messages.position)
      .all();
    return rows.map((message) => ({
      ...message,
      metadata: message.metadata as Metadata | undefined,
    }));
  }

  async uiMessages(
    workspaceId: string,
    chatId: string,
  ): Promise<ChiefUIMessage[]> {
    const messages = await this.messages(workspaceId, chatId);
    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts as ChiefUIMessage["parts"],
      metadata: {
        createdAt: message.createdAt,
        ...(message.metadata ? { event: message.metadata } : {}),
      },
    }));
  }

  async saveMessages<Metadata>(
    workspaceId: string,
    chatId: string,
    messages: LocalMessage<Metadata>[],
  ) {
    await this.ready;
    await this.db.transaction(async (tx) => {
      const chat = await tx
        .select({ id: schema.chats.id })
        .from(schema.chats)
        .where(
          and(
            eq(schema.chats.id, chatId),
            eq(schema.chats.workspaceId, workspaceId),
          ),
        )
        .get();
      if (!chat) throw new Error("Chat was not found in this workspace.");
      if (messages.some((message) => message.chatId !== chatId)) {
        throw new Error("Message belongs to a different chat.");
      }
      await tx
        .delete(schema.messages)
        .where(eq(schema.messages.chatId, chatId))
        .run();
      if (messages.length > 0) {
        await tx.insert(schema.messages).values(messages).run();
      }
    });
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
      const stored = await tx
        .select({
          workspaceId: schema.chats.workspaceId,
          parentId: schema.chats.parentId,
          visibility: schema.chats.visibility,
          agent: schema.chats.agent,
          title: schema.chats.title,
        })
        .from(schema.chats)
        .where(eq(schema.chats.id, context.id))
        .get();
      if (
        stored &&
        (stored.workspaceId !== context.workspaceId ||
          stored.agent !== context.agentId ||
          (context.parentId !== undefined &&
            stored.parentId !== context.parentId) ||
          (context.visibility !== undefined &&
            stored.visibility !== context.visibility))
      ) {
        throw new Error("Chat identity does not match stored state.");
      }
      if (context.parentId) {
        const parent = await tx
          .select({ workspaceId: schema.chats.workspaceId })
          .from(schema.chats)
          .where(eq(schema.chats.id, context.parentId))
          .get();
        if (parent?.workspaceId !== context.workspaceId) {
          throw new Error("Parent chat belongs to a different workspace.");
        }
      }
      await tx
        .insert(schema.chats)
        .values({
          id: context.id,
          workspaceId: context.workspaceId,
          parentId: context.parentId,
          triggerId: context.triggerId,
          visibility:
            context.visibility ??
            (context.parentId || context.id.startsWith("automation-")
              ? "private"
              : "user"),
          agent: context.agentId,
          title: (titleOverride ?? firstText).slice(0, 72),
          lastText: lastText.slice(0, 200),
          provider: context.driver,
          model: context.model,
          providerState: context.providerState,
          eveState: context.eveState,
          status: context.status ?? transcriptStatus(events),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
      const updated = await tx
        .update(schema.chats)
        .set({
          ...(titleOverride || !stored?.title
            ? { title: (titleOverride ?? firstText).slice(0, 72) }
            : {}),
          lastText: lastText.slice(0, 200),
          provider: context.driver,
          model: context.model,
          ...(context.providerState !== undefined
            ? { providerState: context.providerState }
            : {}),
          ...(context.eveState !== undefined
            ? { eveState: context.eveState }
            : {}),
          status: context.status ?? transcriptStatus(events),
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
      const existing = await tx
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.chatId, context.id))
        .orderBy(schema.messages.position)
        .all();
      const existingByValue = new Map<string, typeof existing>();
      for (const message of existing) {
        const key = eventKey(message);
        existingByValue.set(key, [
          ...(existingByValue.get(key) ?? []),
          message,
        ]);
      }
      const messages = uiEventMessages(durable).map((normalized, position) => {
        const matches = existingByValue.get(eventKey(normalized));
        const samePosition = existing[position];
        const prior =
          samePosition?.role === normalized.role
            ? samePosition
            : matches?.shift();
        return {
          id: prior?.id ?? normalized.sourceId ?? randomUUID(),
          chatId: context.id,
          role: normalized.role,
          parts: normalized.parts,
          metadata: normalized.metadata,
          position,
          createdAt: prior?.createdAt ?? now,
        };
      });
      await tx
        .delete(schema.messages)
        .where(eq(schema.messages.chatId, context.id))
        .run();
      if (messages.length > 0) {
        await tx.insert(schema.messages).values(messages).run();
      }
    });
  }

  async listChats(workspaceId: string): Promise<LocalChatSummary[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.chats)
      .where(
        and(
          eq(schema.chats.workspaceId, workspaceId),
          eq(schema.chats.visibility, "user"),
          isNull(schema.chats.parentId),
          eq(schema.chats.agent, "cmo"),
          notExists(
            this.db
              .select({ id: schema.recurringWork.id })
              .from(schema.recurringWork)
              .where(eq(schema.recurringWork.chatId, schema.chats.id)),
          ),
        ),
      )
      .orderBy(desc(schema.chats.updatedAt))
      .all();
    return rows.map((chat) => ({
      id: chat.id,
      title: chat.title,
      lastText: chat.lastText,
      lastAt: chat.updatedAt,
      driver: driver(chat.provider),
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
          title: chat.title,
          lastText: chat.lastText,
          lastAt: chat.updatedAt,
          driver: driver(chat.provider),
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
    return (await this.messages(workspaceId, chatId)).flatMap((message) => {
      const event = agentEvent(message);
      return event && !isLegacyLauncherError(event) ? [event] : [];
    });
  }

  async deleteChat(workspaceId: string, chatId: string) {
    await this.ready;
    await this.db.transaction(async (tx) => {
      const schedule = await tx
        .select({ id: schema.recurringWork.id })
        .from(schema.recurringWork)
        .where(
          and(
            eq(schema.recurringWork.chatId, chatId),
            eq(schema.recurringWork.workspaceId, workspaceId),
          ),
        )
        .get();
      if (schedule) {
        throw new Error(
          "Schedule chats cannot be deleted from Conversations. Delete the schedule instead.",
        );
      }
      await tx
        .delete(schema.chats)
        .where(
          and(
            eq(schema.chats.id, chatId),
            eq(schema.chats.workspaceId, workspaceId),
          ),
        )
        .run();
    });
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

  async recurringWorkByChat(workspaceId: string, chatId: string) {
    await this.ready;
    return this.db
      .select({ id: schema.recurringWork.id })
      .from(schema.recurringWork)
      .where(
        and(
          eq(schema.recurringWork.workspaceId, workspaceId),
          eq(schema.recurringWork.chatId, chatId),
        ),
      )
      .get();
  }

  async saveRecurringWork(workspaceId: string, work: RecurringWorkRecord) {
    await this.ready;
    const { upcomingRuns: _upcomingRuns, ...persisted } = work;
    const chat = await this.db
      .select({
        workspaceId: schema.chats.workspaceId,
        parentId: schema.chats.parentId,
        visibility: schema.chats.visibility,
        agent: schema.chats.agent,
      })
      .from(schema.chats)
      .where(eq(schema.chats.id, work.chatId))
      .get();
    if (
      chat?.workspaceId !== workspaceId ||
      chat.parentId !== null ||
      chat.visibility !== "user" ||
      chat.agent !== "cmo"
    ) {
      throw new Error(
        "Schedules require a top-level CMO chat in this workspace.",
      );
    }
    const existing = await this.db
      .select({
        workspaceId: schema.recurringWork.workspaceId,
        chatId: schema.recurringWork.chatId,
      })
      .from(schema.recurringWork)
      .where(eq(schema.recurringWork.id, work.id))
      .get();
    if (existing && existing.workspaceId !== workspaceId) {
      throw new Error("Recurring work belongs to a different workspace.");
    }
    if (existing && existing.chatId !== work.chatId) {
      throw new Error("A schedule cannot change its durable root chat.");
    }
    await this.db
      .insert(schema.recurringWork)
      .values({ ...persisted, workspaceId })
      .onConflictDoUpdate({
        target: schema.recurringWork.id,
        set: {
          chatId: work.chatId,
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

  async listAttentionItems(workspaceId: string): Promise<AttentionItem[]> {
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

  async raiseAttentionItem(workspaceId: string, item: AttentionItem) {
    await this.ready;
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ workspaceId: schema.attentionItems.workspaceId })
        .from(schema.attentionItems)
        .where(eq(schema.attentionItems.id, item.id))
        .get();
      if (existing && existing.workspaceId !== workspaceId) {
        throw new Error("Attention item belongs to a different workspace.");
      }
      await tx
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
    });
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
        chatId: schema.recurringWorkRuns.chatId,
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
          .select()
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.chatId, run.chatId),
              gte(schema.messages.createdAt, run.startedAt),
            ),
          )
          .all();
        const touchedTools = hasPotentialSideEffects(
          transcriptRows.flatMap((row) => {
            const event = agentEvent({
              ...row,
              metadata: row.metadata as AgentMessageMetadata | undefined,
            });
            return event ? [event] : [];
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
    const work = await this.recurringWorkById(workspaceId, run.recurringWorkId);
    if (work?.chatId !== run.chatId) {
      throw new Error("Run chat does not match its schedule root chat.");
    }
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
        const work = await tx
          .select({ chatId: schema.recurringWork.chatId })
          .from(schema.recurringWork)
          .where(
            and(
              eq(schema.recurringWork.id, run.recurringWorkId),
              eq(schema.recurringWork.workspaceId, workspaceId),
            ),
          )
          .get();
        if (work?.chatId !== run.chatId) {
          throw new Error("Run chat does not match its schedule root chat.");
        }
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
