/* eslint-disable max-lines */

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
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
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  or,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import type {
  ActionItem,
  AgentEvent,
  AgentPreference,
  AnalyticsDataset,
  CampaignRecord,
  ChiefMessageEventMetadata,
  ChiefUIMessage,
  ContentBlock,
  ContentDraftRecord,
  DiagnosticEventRecord,
  DriverType,
  ProspectRecord,
  RecurringWorkRecord,
  ScheduleSessionActionTransition,
  SessionRecord,
  TrendRecord,
  WorkspaceFileRecord,
  WorkspaceFileSnapshot,
} from "./types.js";
import { ChannelStore } from "./channels/store.js";
import * as schema from "./db/schema.js";
import { TRANSIENT_RETRY_DELAY_MS } from "./retry-policy.js";
import { hasPotentialSideEffects } from "./run-safety.js";

const RESTART_SESSION_SUMMARY =
  "Chief restarted before this session returned a result. Nothing external was assumed to have completed.";
const RESTART_SESSION_ERROR =
  "The local runtime restarted during this session.";
const RESTART_RETRY_SUMMARY =
  "Chief restarted before this session used any tools. It will continue automatically.";

class ScheduleSessionClaimConflict extends Error {}

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
  agent: string;
  title: string;
  lastText: string;
  lastAt: number;
  driver?: DriverType;
  model?: string;
}

export type ChatVisibility = "user" | "private";
export type ChatStatus = SessionRecord["status"];

export interface LocalChatRecord {
  id: string;
  organizationId: string;
  parentId?: string;
  triggerId?: string;
  scheduleId?: string;
  kind: SessionRecord["kind"];
  visibility: ChatVisibility;
  agent: string;
  title: string;
  lastText: string;
  provider: string;
  model?: string;
  providerState?: unknown;
  eveState?: unknown;
  status: ChatStatus;
  scheduledFor?: number;
  startedAt?: number;
  finishedAt?: number;
  attempt: number;
  summary?: string;
  error?: string;
  artifacts?: SessionRecord["artifacts"];
  blockedTools?: string[];
  createdAt: number;
  updatedAt: number;
}

export type AgentMessageMetadata =
  | ChiefMessageEventMetadata
  | {
      type: "channel";
      threadRootId?: string;
      mentions?: string[];
    };

export interface LocalMessage<Metadata = AgentMessageMetadata> {
  id: string;
  sessionId: string;
  role: "system" | "user" | "assistant";
  parts: unknown[];
  metadata?: Metadata;
  position: number;
  createdAt: number;
}

export interface ChatContext {
  id: string;
  organizationId: string;
  agentId: string;
  driver: DriverType;
  model?: string;
  parentId?: string;
  triggerId?: string;
  scheduleId?: string;
  kind?: SessionRecord["kind"];
  visibility?: ChatVisibility;
  providerState?: unknown;
  eveState?: unknown;
  status?: ChatStatus;
  scheduledFor?: number;
  startedAt?: number;
  finishedAt?: number;
  attempt?: number;
  summary?: string;
  error?: string;
  artifacts?: SessionRecord["artifacts"];
  blockedTools?: string[];
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

function eventMessage(event: AgentEvent) {
  if (event.type === "message") {
    return {
      role: event.role,
      parts: event.content,
      ...(event.threadRootId || event.mentions?.length
        ? {
            metadata: {
              type: "channel" as const,
              threadRootId: event.threadRootId,
              mentions: event.mentions,
            } satisfies AgentMessageMetadata,
          }
        : {}),
    } as const;
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

    let mergedToolTarget: (typeof messages)[number] | undefined;
    const remaining = event.content.filter((block) => {
      if (
        mergedToolTarget &&
        (block.type === "data-chart" ||
          block.type === "data-table" ||
          block.type === "data-document")
      ) {
        const part = uiParts([block])[0];
        if (
          part &&
          !mergedToolTarget.parts.some(
            (candidate) =>
              candidate.type === part.type &&
              "id" in candidate &&
              "id" in part &&
              candidate.id === part.id,
          )
        ) {
          mergedToolTarget.parts.push(part);
        }
        return false;
      }
      mergedToolTarget = undefined;
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
        mergedToolTarget = prior;
        return false;
      }
      return true;
    });
    if (remaining.length === 0) continue;
    const nextParts = uiParts(remaining).filter((part, index, parts) => {
      if (part.type !== "dynamic-tool") return true;
      const matching = (candidate: ChiefUIMessage["parts"][number]) =>
        candidate.type === "dynamic-tool" &&
        candidate.toolCallId === part.toolCallId;
      let matchingIndex = -1;
      let completedIndex = -1;
      for (
        let candidateIndex = parts.length - 1;
        candidateIndex >= 0;
        candidateIndex--
      ) {
        const candidate = parts[candidateIndex];
        if (!candidate || !matching(candidate)) continue;
        if (matchingIndex < 0) matchingIndex = candidateIndex;
        if (
          candidate.type === "dynamic-tool" &&
          (candidate.state === "output-available" ||
            candidate.state === "output-error")
        ) {
          completedIndex = candidateIndex;
          break;
        }
      }
      return index === (completedIndex >= 0 ? completedIndex : matchingIndex);
    });
    let prior: (typeof messages)[number] | undefined;
    if (event.id) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const candidate = messages[index];
        if (candidate?.sourceId === event.id && candidate.role === event.role) {
          prior = candidate;
          break;
        }
      }
    }
    if (prior) {
      for (const part of nextParts) {
        if (part.type === "dynamic-tool") {
          const index = prior.parts.findIndex(
            (candidate) =>
              candidate.type === "dynamic-tool" &&
              candidate.toolCallId === part.toolCallId,
          );
          if (index >= 0) {
            const existing = prior.parts[index];
            const existingDone =
              existing?.type === "dynamic-tool" &&
              (existing.state === "output-available" ||
                existing.state === "output-error");
            if (!existingDone) prior.parts[index] = part;
            continue;
          }
        }
        if (
          part.type === "text" &&
          prior.parts.some(
            (candidate) =>
              candidate.type === "text" && candidate.text === part.text,
          )
        ) {
          continue;
        }
        prior.parts.push(part);
      }
      continue;
    }
    messages.push({
      sourceId: event.id,
      role: event.role,
      parts: nextParts,
      metadata: converted.metadata,
    });
  }
  return messages;
}

function agentEvent(message: LocalMessage): AgentEvent | undefined {
  if (message.metadata?.type === "channel") {
    return {
      type: "message",
      id: message.id,
      role: message.role === "system" ? "user" : message.role,
      content: contentBlocks(message.parts as ChiefUIMessage["parts"]),
      threadRootId: message.metadata.threadRootId,
      mentions: message.metadata.mentions,
    };
  }
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

function transcriptStatus(events: AgentEvent[]): ChatStatus | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!event) continue;
    if (event.type === "error") return "failed";
    if (event.type === "result") return event.ok ? "completed" : "failed";
    if (event.type === "status")
      return event.status === "error" ? "failed" : event.status;
  }
  return undefined;
}

function driver(provider: string): DriverType | undefined {
  return provider === "claude" ||
    provider === "codex" ||
    provider === "opencode" ||
    provider === "remote"
    ? provider
    : undefined;
}

function localChatRecord(
  row: typeof schema.sessions.$inferSelect,
): LocalChatRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    parentId: row.parentId ?? undefined,
    triggerId: row.triggerId ?? undefined,
    scheduleId: row.scheduleId ?? undefined,
    kind: row.kind,
    visibility: row.visibility,
    agent: row.agent,
    title: row.title,
    lastText: row.lastText,
    provider: row.provider,
    model: row.model ?? undefined,
    providerState: row.providerState ?? undefined,
    eveState: row.eveState ?? undefined,
    status: row.status,
    scheduledFor: row.scheduledFor ?? undefined,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    attempt: row.attempt,
    summary: row.summary ?? undefined,
    error: row.error ?? undefined,
    artifacts: row.artifacts ?? undefined,
    blockedTools: row.blockedTools ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sessionRecord(
  row: typeof schema.sessions.$inferSelect,
): SessionRecord {
  const chat = localChatRecord(row);
  return {
    id: chat.id,
    parentId: chat.parentId,
    triggerId: chat.triggerId,
    scheduleId: chat.scheduleId,
    kind: chat.kind,
    visibility: chat.visibility,
    agent: chat.agent,
    title: chat.title,
    provider: chat.provider,
    model: chat.model,
    status: chat.status,
    scheduledFor: chat.scheduledFor,
    startedAt: chat.startedAt,
    finishedAt: chat.finishedAt,
    attempt: chat.attempt,
    summary: chat.summary,
    error: chat.error,
    artifacts: chat.artifacts,
    blockedTools: chat.blockedTools,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

function diagnosticSessionRecord(
  row: typeof schema.sessions.$inferSelect,
): SessionRecord {
  return {
    ...sessionRecord(row),
    lastText: redactString(row.lastText),
    summary: row.summary ? redactString(row.summary) : undefined,
    error: row.error ? redactString(row.error) : undefined,
  };
}

const MAX_DIAGNOSTIC_EVENT_BYTES = 64 * 1024;
const SECRET_KEY =
  /(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|client[_-]?secret)/i;
const STRING_SECRET_ASSIGNMENT =
  /(["']?(?:password|passwd|secret|token|access[_-]?token|refresh[_-]?token|authorization|cookie|api[_-]?key|credential|private[_-]?key|client[_-]?secret)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi;
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PREFIXED_SECRET =
  /\b(?:sk-(?:(?:proj|ant)-)?|[spr]k_live_|gh[pousr]_|github_pat_|glpat-|v(?:cp|ci|ca|cr|ck)_|npm_|pypi-|xox[baprs]-|ya29\.|AIza|AKIA|ASIA|SG\.)[A-Za-z0-9_./+=-]{8,}/g;
const JWT_SECRET = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const PRODUCT_ACTION_SOURCE = /^(?:agent|automation)-[A-Za-z0-9_-]+$/;

function redactString(value: string) {
  return value
    .replace(BEARER_SECRET, "Bearer [REDACTED]")
    .replace(PREFIXED_SECRET, "[REDACTED]")
    .replace(JWT_SECRET, "[REDACTED]")
    .replace(STRING_SECRET_ASSIGNMENT, "$1[REDACTED]");
}

function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return redactString(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, seen));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? "[REDACTED]" : redactSecrets(item, seen),
    ]),
  );
}

function diagnosticData(event: AgentEvent) {
  const redacted = redactSecrets(event);
  const bytes = Buffer.byteLength(JSON.stringify(redacted), "utf8");
  return bytes <= MAX_DIAGNOSTIC_EVENT_BYTES
    ? redacted
    : { type: event.type, truncated: true, originalBytes: bytes };
}

function diagnosticLevel(event: AgentEvent): DiagnosticEventRecord["level"] {
  if (event.type === "error") return "error";
  if (event.type === "result") return event.ok ? "info" : "error";
  if (event.type === "exit") return event.code === 0 ? "info" : "error";
  if (event.type === "permission") return "warn";
  if (event.type === "status" && event.status === "error") return "error";
  if (event.type === "stream" || event.type === "toolProgress") return "debug";
  return "info";
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
  private client: Client;
  private db: LibSQLDatabase;
  private readonly ready: Promise<void>;

  constructor(path = defaultDatabasePath()) {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (directory.startsWith(join(homedir(), ".chief"))) {
      chmodSync(directory, 0o700);
    }
    const key = encryptionKey(directory);
    const openDatabase = () => {
      const client = createClient({
        url: `file:${path}`,
        encryptionKey: key,
        timeout: 5_000,
      });
      return { client, db: drizzle({ client }) };
    };
    let { client, db } = openDatabase();
    this.client = client;
    this.db = db;
    this.ready = (async () => {
      const initialize = async () => {
        await client.execute("PRAGMA journal_mode = WAL");
        await client.execute("PRAGMA busy_timeout = 5000");
        await client.execute("PRAGMA foreign_keys = ON");
        await migrate(db, {
          migrationsFolder: migrationFolder(),
        });
      };
      try {
        await initialize();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/SQLITE_ERROR:.*table .+ already exists/i.test(message))
          throw error;

        // Baseline replacements are intentionally destructive while Chief is
        // pre-release. An installed development build may retain the old DB.
        client.close();
        for (const suffix of ["", "-wal", "-shm"]) {
          rmSync(`${path}${suffix}`, { force: true });
        }
        ({ client, db } = openDatabase());
        this.client = client;
        this.db = db;
        await initialize();
      }
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
  channelStore = () => new ChannelStore(() => this.db, this.ready);
  async hasChat(chatId: string) {
    await this.ready;
    return Boolean(
      await this.db
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, chatId))
        .get(),
    );
  }
  async createChat(
    chat: Omit<
      LocalChatRecord,
      | "title"
      | "lastText"
      | "kind"
      | "status"
      | "attempt"
      | "createdAt"
      | "updatedAt"
    > &
      Partial<
        Pick<
          LocalChatRecord,
          | "title"
          | "lastText"
          | "kind"
          | "status"
          | "attempt"
          | "createdAt"
          | "updatedAt"
        >
      >,
  ) {
    await this.ready;
    const now = Date.now();
    if (chat.parentId) {
      const parent = await this.db
        .select({ organizationId: schema.sessions.organizationId })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, chat.parentId))
        .get();
      if (parent?.organizationId !== chat.organizationId) {
        throw new Error("Parent chat belongs to a different workspace.");
      }
    }
    if (chat.scheduleId) {
      const schedule = await this.db
        .select({
          organizationId: schema.schedules.organizationId,
          conversationId: schema.schedules.conversationId,
        })
        .from(schema.schedules)
        .where(eq(schema.schedules.id, chat.scheduleId))
        .get();
      if (schedule?.organizationId !== chat.organizationId) {
        throw new Error("Schedule belongs to a different workspace.");
      }
      if (chat.parentId && chat.parentId !== schedule.conversationId) {
        throw new Error(
          "Schedule session parent does not match its conversation.",
        );
      }
    }
    const kind =
      chat.kind ?? (chat.parentId || chat.scheduleId ? "task" : "conversation");
    if ((chat.parentId || chat.scheduleId) && chat.visibility !== "private") {
      throw new Error("Child and scheduled sessions must be private.");
    }
    if ((chat.parentId || chat.scheduleId) && kind !== "task") {
      throw new Error("Child and scheduled sessions must be tasks.");
    }
    if (
      chat.scheduleId &&
      (chat.agent !== "cmo" ||
        chat.scheduledFor === undefined ||
        chat.startedAt === undefined)
    ) {
      throw new Error(
        "Schedule sessions require a scheduled time, start time, and CMO agent.",
      );
    }
    await this.db
      .insert(schema.sessions)
      .values({
        id: chat.id,
        organizationId: chat.organizationId,
        parentId: chat.parentId,
        triggerId: chat.triggerId,
        scheduleId: chat.scheduleId,
        kind,
        visibility: chat.visibility,
        agent: chat.agent,
        title: chat.title ?? "",
        lastText: chat.lastText ?? "",
        provider: chat.provider,
        model: chat.model,
        providerState: chat.providerState,
        eveState: chat.eveState,
        status: chat.status ?? "idle",
        scheduledFor: chat.scheduledFor,
        startedAt: chat.startedAt,
        finishedAt: chat.finishedAt,
        attempt: chat.attempt ?? 1,
        summary: chat.summary,
        error: chat.error,
        artifacts: chat.artifacts,
        blockedTools: chat.blockedTools,
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
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.id, chatId),
          eq(schema.sessions.organizationId, workspaceId),
        ),
      )
      .get();
    return row ? localChatRecord(row) : null;
  }

  async listChildChats(workspaceId: string, parentId: string) {
    await this.ready;
    const rows = await this.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.organizationId, workspaceId),
          eq(schema.sessions.parentId, parentId),
          eq(schema.sessions.visibility, "private"),
        ),
      )
      .orderBy(schema.sessions.createdAt)
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
      provider?: string;
      model?: string | null;
      providerState?: unknown;
      eveState?: unknown;
      status?: ChatStatus;
      startedAt?: number;
    },
  ) {
    await this.ready;
    const updated = await this.db
      .update(schema.sessions)
      .set({ ...state, updatedAt: Date.now() })
      .where(
        and(
          eq(schema.sessions.id, chatId),
          eq(schema.sessions.organizationId, workspaceId),
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
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.id, chatId),
          eq(schema.sessions.organizationId, workspaceId),
        ),
      )
      .get();
    if (!chat) return [];
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.organizationId, workspaceId),
          eq(schema.messages.sessionId, chatId),
        ),
      )
      .orderBy(schema.messages.position)
      .all();
    return rows.map((message) => ({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata as Metadata | undefined,
      position: message.position,
      createdAt: message.createdAt,
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
        ...(message.metadata?.type === "channel"
          ? {
              threadRootId: message.metadata.threadRootId,
              mentions: message.metadata.mentions,
            }
          : message.metadata
            ? { event: message.metadata }
            : {}),
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
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.id, chatId),
            eq(schema.sessions.organizationId, workspaceId),
          ),
        )
        .get();
      if (!chat) throw new Error("Chat was not found in this workspace.");
      if (messages.some((message) => message.sessionId !== chatId)) {
        throw new Error("Message belongs to a different chat.");
      }
      await tx
        .delete(schema.messages)
        .where(
          and(
            eq(schema.messages.organizationId, workspaceId),
            eq(schema.messages.sessionId, chatId),
          ),
        )
        .run();
      if (messages.length > 0) {
        await tx
          .insert(schema.messages)
          .values(
            messages.map((message) => ({
              ...message,
              organizationId: workspaceId,
            })),
          )
          .run();
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
          organizationId: schema.sessions.organizationId,
          parentId: schema.sessions.parentId,
          scheduleId: schema.sessions.scheduleId,
          kind: schema.sessions.kind,
          visibility: schema.sessions.visibility,
          agent: schema.sessions.agent,
          title: schema.sessions.title,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, context.id))
        .get();
      if (
        stored &&
        (stored.organizationId !== context.organizationId ||
          stored.agent !== context.agentId ||
          (context.parentId !== undefined &&
            stored.parentId !== context.parentId) ||
          (context.scheduleId !== undefined &&
            stored.scheduleId !== context.scheduleId) ||
          (context.kind !== undefined && stored.kind !== context.kind) ||
          (context.visibility !== undefined &&
            stored.visibility !== context.visibility))
      ) {
        throw new Error("Chat identity does not match stored state.");
      }
      if (context.parentId) {
        const parent = await tx
          .select({ organizationId: schema.sessions.organizationId })
          .from(schema.sessions)
          .where(eq(schema.sessions.id, context.parentId))
          .get();
        if (parent?.organizationId !== context.organizationId) {
          throw new Error("Parent chat belongs to a different workspace.");
        }
      }
      const kind =
        context.kind ??
        (context.parentId || context.scheduleId ? "task" : "conversation");
      const visibility =
        context.visibility ??
        (context.parentId || context.scheduleId ? "private" : "user");
      const status = context.status ?? transcriptStatus(events);
      if (
        (context.parentId || context.scheduleId) &&
        (kind !== "task" || visibility !== "private")
      ) {
        throw new Error("Child and scheduled sessions must be private tasks.");
      }
      if (context.scheduleId && !stored) {
        const schedule = await tx
          .select({
            organizationId: schema.schedules.organizationId,
            conversationId: schema.schedules.conversationId,
          })
          .from(schema.schedules)
          .where(eq(schema.schedules.id, context.scheduleId))
          .get();
        if (schedule?.organizationId !== context.organizationId) {
          throw new Error("Schedule belongs to a different workspace.");
        }
        if (context.parentId && context.parentId !== schedule.conversationId) {
          throw new Error(
            "Schedule session parent does not match its conversation.",
          );
        }
        if (
          context.agentId !== "cmo" ||
          context.scheduledFor === undefined ||
          context.startedAt === undefined
        ) {
          throw new Error(
            "Schedule sessions require a scheduled time, start time, and CMO agent.",
          );
        }
      }
      await tx
        .insert(schema.sessions)
        .values({
          id: context.id,
          organizationId: context.organizationId,
          parentId: context.parentId,
          triggerId: context.triggerId,
          scheduleId: context.scheduleId,
          kind,
          visibility,
          agent: context.agentId,
          title: (titleOverride ?? firstText).slice(0, 72),
          lastText: lastText.slice(0, 200),
          provider: context.driver,
          model: context.model,
          providerState: context.providerState,
          eveState: context.eveState,
          status: status ?? "idle",
          scheduledFor: context.scheduledFor,
          startedAt: context.startedAt,
          finishedAt: context.finishedAt,
          attempt: context.attempt ?? 1,
          summary: context.summary,
          error: context.error,
          artifacts: context.artifacts,
          blockedTools: context.blockedTools,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
      const updated = await tx
        .update(schema.sessions)
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
          ...(status && !stored?.scheduleId ? { status } : {}),
          ...(context.scheduledFor !== undefined
            ? { scheduledFor: context.scheduledFor }
            : {}),
          ...(context.startedAt !== undefined
            ? { startedAt: context.startedAt }
            : {}),
          ...(context.finishedAt !== undefined
            ? { finishedAt: context.finishedAt }
            : {}),
          ...(context.attempt !== undefined
            ? { attempt: context.attempt }
            : {}),
          ...(context.summary !== undefined
            ? { summary: context.summary }
            : {}),
          ...(context.error !== undefined ? { error: context.error } : {}),
          ...(context.artifacts !== undefined
            ? { artifacts: context.artifacts }
            : {}),
          ...(context.blockedTools !== undefined
            ? { blockedTools: context.blockedTools }
            : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.sessions.id, context.id),
            eq(schema.sessions.organizationId, context.organizationId),
          ),
        )
        .run();
      if (updated.rowsAffected === 0) {
        throw new Error("Chat belongs to a different workspace.");
      }
      const existing = await tx
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.organizationId, context.organizationId),
            eq(schema.messages.sessionId, context.id),
          ),
        )
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
      const usedMessageIds = new Set<string>();
      const messages = uiEventMessages(durable).map((normalized, position) => {
        const matches = existingByValue.get(eventKey(normalized));
        const samePosition = existing[position];
        const prior =
          samePosition?.role === normalized.role
            ? samePosition
            : matches?.shift();
        const candidates = [prior?.id, normalized.sourceId];
        const id =
          candidates.find(
            (candidate): candidate is string =>
              typeof candidate === "string" && !usedMessageIds.has(candidate),
          ) ?? randomUUID();
        usedMessageIds.add(id);
        return {
          id,
          organizationId: context.organizationId,
          sessionId: context.id,
          role: normalized.role,
          parts: normalized.parts,
          metadata: normalized.metadata,
          position,
          createdAt: prior?.createdAt ?? now,
        };
      });
      await tx
        .delete(schema.messages)
        .where(
          and(
            eq(schema.messages.organizationId, context.organizationId),
            eq(schema.messages.sessionId, context.id),
          ),
        )
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
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.organizationId, workspaceId),
          eq(schema.sessions.kind, "conversation"),
          eq(schema.sessions.visibility, "user"),
          isNull(schema.sessions.parentId),
        ),
      )
      .orderBy(desc(schema.sessions.updatedAt))
      .all();
    return rows.map((chat) => ({
      id: chat.id,
      agent: chat.agent,
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
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.id, chatId),
          eq(schema.sessions.organizationId, workspaceId),
        ),
      )
      .get();
    return chat
      ? {
          id: chat.id,
          agent: chat.agent,
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
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.id, chatId),
          eq(schema.sessions.organizationId, workspaceId),
        ),
      )
      .get();
    if (!chat) return [];
    return (await this.messages(workspaceId, chatId)).flatMap((message) => {
      const event = agentEvent(message);
      return event ? [event] : [];
    });
  }

  async deleteChat(workspaceId: string, chatId: string) {
    await this.ready;
    await this.db.transaction(async (tx) => {
      const conversation = await tx
        .select({
          kind: schema.sessions.kind,
          visibility: schema.sessions.visibility,
        })
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.id, chatId),
            eq(schema.sessions.organizationId, workspaceId),
          ),
        )
        .get();
      if (!conversation) return;
      if (
        conversation.kind === "conversation" &&
        conversation.visibility === "user"
      ) {
        const schedule = await tx
          .select({ id: schema.schedules.id })
          .from(schema.schedules)
          .where(
            and(
              eq(schema.schedules.organizationId, workspaceId),
              eq(schema.schedules.conversationId, chatId),
            ),
          )
          .get();
        if (schedule) {
          throw new Error(
            "This Workspace conversation is used by a Schedule. Delete the Schedule before deleting the conversation.",
          );
        }
      }
      await tx
        .delete(schema.sessions)
        .where(
          and(
            eq(schema.sessions.id, chatId),
            eq(schema.sessions.organizationId, workspaceId),
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
      .where(eq(schema.prospects.organizationId, workspaceId))
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
      .select({ organizationId: schema.prospects.organizationId })
      .from(schema.prospects)
      .where(eq(schema.prospects.id, prospect.id))
      .get();
    if (existing && existing.organizationId !== workspaceId) {
      throw new Error("Prospect belongs to a different workspace.");
    }
    await this.db
      .insert(schema.prospects)
      .values({
        ...prospect,
        organizationId: workspaceId,
        updatedAt: Date.now(),
      })
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
      .where(eq(schema.trends.organizationId, workspaceId))
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
      .select({ organizationId: schema.trends.organizationId })
      .from(schema.trends)
      .where(eq(schema.trends.id, trend.id))
      .get();
    if (existing && existing.organizationId !== workspaceId) {
      throw new Error("Trend belongs to a different workspace.");
    }
    await this.db
      .insert(schema.trends)
      .values({ ...trend, organizationId: workspaceId, updatedAt: Date.now() })
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

  async listAnalyticsDatasets(
    workspaceId: string,
  ): Promise<AnalyticsDataset[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.analyticsDatasets)
      .where(eq(schema.analyticsDatasets.organizationId, workspaceId))
      .orderBy(desc(schema.analyticsDatasets.capturedAt))
      .all();
    return rows.map((row) => ({
      ...row.data,
      provider: row.provider,
      key: row.key,
      sourceId: row.sourceId || undefined,
      capturedAt: row.capturedAt,
    }));
  }

  async saveAnalyticsDataset(
    workspaceId: string,
    input: Omit<AnalyticsDataset, "capturedAt">,
  ): Promise<AnalyticsDataset> {
    await this.ready;
    const capturedAt = Date.now();
    const dataset = { ...input, capturedAt };
    const sourceId = input.sourceId ?? "";
    await this.db
      .insert(schema.analyticsDatasets)
      .values({
        organizationId: workspaceId,
        provider: input.provider,
        key: input.key,
        sourceId,
        data: dataset,
        capturedAt,
      })
      .onConflictDoUpdate({
        target: [
          schema.analyticsDatasets.organizationId,
          schema.analyticsDatasets.provider,
          schema.analyticsDatasets.key,
          schema.analyticsDatasets.sourceId,
        ],
        set: { data: dataset, capturedAt },
      })
      .run();
    return dataset;
  }

  async listDrafts(workspaceId: string): Promise<ContentDraftRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.contentDrafts)
      .where(eq(schema.contentDrafts.organizationId, workspaceId))
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
      .select({ organizationId: schema.contentDrafts.organizationId })
      .from(schema.contentDrafts)
      .where(eq(schema.contentDrafts.id, draft.id))
      .get();
    if (existing && existing.organizationId !== workspaceId) {
      throw new Error("Content draft belongs to a different workspace.");
    }
    await this.db
      .insert(schema.contentDrafts)
      .values({ ...draft, organizationId: workspaceId })
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
      .where(eq(schema.workspaceFiles.organizationId, workspaceId))
      .orderBy(desc(schema.workspaceFiles.updatedAt))
      .all();
    return rows.map((file) => ({
      ...file,
      sourceAgentId: file.sourceAgentId ?? undefined,
      sourceSessionId: file.sourceSessionId ?? undefined,
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
          eq(schema.workspaceFiles.organizationId, workspaceId),
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
          eq(schema.workspaceFileVersions.organizationId, workspaceId),
        ),
      )
      .get();
    if (!version) throw new Error("The current file revision is unavailable.");
    return {
      ...file,
      sourceAgentId: file.sourceAgentId ?? undefined,
      sourceSessionId: file.sourceSessionId ?? undefined,
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
          organizationId: schema.workspaceFiles.organizationId,
          currentVersionId: schema.workspaceFiles.currentVersionId,
        })
        .from(schema.workspaceFiles)
        .where(eq(schema.workspaceFiles.id, file.id))
        .get();
      if (existing && existing.organizationId !== workspaceId) {
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
          organizationId: workspaceId,
          name: file.name,
          path: file.path,
          mimeType: file.mimeType,
          kind: file.kind,
          provider: file.provider,
          currentVersionId: file.currentVersionId,
          createdBy: file.createdBy,
          sourceAgentId: file.sourceAgentId,
          sourceSessionId: file.sourceSessionId,
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
            sourceSessionId: file.sourceSessionId,
            updatedAt: file.updatedAt,
          },
        })
        .run();
      await tx
        .insert(schema.workspaceFileVersions)
        .values({
          id: file.currentVersionId,
          fileId: file.id,
          organizationId: workspaceId,
          content: file.content,
          size: Buffer.byteLength(file.content, "utf8"),
          createdBy: file.createdBy,
          sourceAgentId: file.sourceAgentId,
          sourceSessionId: file.sourceSessionId,
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
          eq(schema.workspaceFiles.organizationId, workspaceId),
        ),
      )
      .run();
  }

  async listRecurringWork(workspaceId: string): Promise<RecurringWorkRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.organizationId, workspaceId))
      .orderBy(schema.schedules.nextAt)
      .all();
    return rows.map((work) => ({
      id: work.id,
      conversationId: work.conversationId ?? undefined,
      agentId: work.agentId,
      title: work.title,
      instructions: work.instructions,
      cron: work.cron,
      timezone: work.timezone,
      onceAt: work.onceAt ?? undefined,
      status: work.status,
      placement: work.placement,
      grant: work.grant ?? undefined,
      skipDates: work.skipDates ?? undefined,
      approvalSummary: work.approvalSummary,
      proposedToolPatterns: work.proposedToolPatterns,
      nextAt: work.nextAt ?? undefined,
      lastCompletedAt: work.lastCompletedAt ?? undefined,
      lastSummary: work.lastSummary ?? undefined,
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
    }));
  }

  async recurringWorkById(workspaceId: string, id: string) {
    await this.ready;
    const row = await this.db
      .select()
      .from(schema.schedules)
      .where(
        and(
          eq(schema.schedules.id, id),
          eq(schema.schedules.organizationId, workspaceId),
        ),
      )
      .get();
    return row
      ? ({
          id: row.id,
          conversationId: row.conversationId ?? undefined,
          agentId: row.agentId,
          title: row.title,
          instructions: row.instructions,
          cron: row.cron,
          timezone: row.timezone,
          onceAt: row.onceAt ?? undefined,
          status: row.status,
          placement: row.placement,
          grant: row.grant ?? undefined,
          skipDates: row.skipDates ?? undefined,
          approvalSummary: row.approvalSummary,
          proposedToolPatterns: row.proposedToolPatterns,
          nextAt: row.nextAt ?? undefined,
          lastCompletedAt: row.lastCompletedAt ?? undefined,
          lastSummary: row.lastSummary ?? undefined,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        } satisfies RecurringWorkRecord)
      : undefined;
  }

  async saveRecurringWork(workspaceId: string, work: RecurringWorkRecord) {
    await this.ready;
    if (work.conversationId) {
      const conversation = await this.db
        .select({
          organizationId: schema.sessions.organizationId,
          parentId: schema.sessions.parentId,
          kind: schema.sessions.kind,
          visibility: schema.sessions.visibility,
          agent: schema.sessions.agent,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, work.conversationId))
        .get();
      if (
        conversation?.organizationId !== workspaceId ||
        conversation.parentId !== null ||
        conversation.kind !== "conversation" ||
        conversation.visibility !== "user" ||
        conversation.agent !== "cmo"
      ) {
        throw new Error(
          "Schedule conversations must be top-level user-visible CMO conversations in this workspace.",
        );
      }
    }
    const existing = await this.db
      .select({ organizationId: schema.schedules.organizationId })
      .from(schema.schedules)
      .where(eq(schema.schedules.id, work.id))
      .get();
    if (existing && existing.organizationId !== workspaceId) {
      throw new Error("Recurring work belongs to a different workspace.");
    }
    await this.db
      .insert(schema.schedules)
      .values({
        id: work.id,
        organizationId: workspaceId,
        conversationId: work.conversationId,
        agentId: work.agentId,
        title: work.title,
        instructions: work.instructions,
        cron: work.cron,
        timezone: work.timezone,
        onceAt: work.onceAt,
        status: work.status,
        placement: work.placement,
        skipDates: work.skipDates,
        approvalSummary: work.approvalSummary,
        proposedToolPatterns: work.proposedToolPatterns,
        grant: work.grant,
        nextAt: work.nextAt,
        lastCompletedAt: work.lastCompletedAt,
        lastSummary: work.lastSummary,
        createdAt: work.createdAt,
        updatedAt: work.updatedAt,
      })
      .onConflictDoUpdate({
        target: schema.schedules.id,
        set: {
          conversationId: work.conversationId ?? null,
          agentId: work.agentId,
          title: work.title,
          instructions: work.instructions,
          cron: work.cron,
          timezone: work.timezone,
          onceAt: work.onceAt ?? null,
          status: work.status,
          placement: work.placement,
          skipDates: work.skipDates ?? null,
          approvalSummary: work.approvalSummary,
          proposedToolPatterns: work.proposedToolPatterns,
          grant: work.grant,
          nextAt: work.nextAt ?? null,
          lastCompletedAt: work.lastCompletedAt,
          lastSummary: work.lastSummary,
          updatedAt: work.updatedAt,
        },
      })
      .run();
  }

  async deleteRecurringWork(workspaceId: string, id: string) {
    await this.ready;
    await this.db
      .delete(schema.schedules)
      .where(
        and(
          eq(schema.schedules.id, id),
          eq(schema.schedules.organizationId, workspaceId),
        ),
      )
      .run();
  }

  async listActionItems(workspaceId: string): Promise<ActionItem[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.actions)
      .where(
        and(
          eq(schema.actions.organizationId, workspaceId),
          eq(schema.actions.status, "open"),
        ),
      )
      .orderBy(desc(schema.actions.createdAt))
      .all();
    return rows.map((item) => ({
      id: item.id,
      agentId: item.agentId,
      title: item.title,
      reason: item.reason,
      sourceId: item.sourceId ?? undefined,
      ...(item.request ? { request: item.request } : {}),
      status: item.status,
      createdAt: item.createdAt,
    }));
  }

  async raiseActionItem(workspaceId: string, item: ActionItem) {
    await this.ready;
    await this.db.transaction(async (tx) => {
      if (item.sourceId && !PRODUCT_ACTION_SOURCE.test(item.sourceId)) {
        const source = await tx
          .select({ organizationId: schema.sessions.organizationId })
          .from(schema.sessions)
          .where(eq(schema.sessions.id, item.sourceId))
          .get();
        if (source?.organizationId !== workspaceId) {
          throw new Error(
            "Action source session was not found in this workspace.",
          );
        }
      }
      const existing = await tx
        .select({ organizationId: schema.actions.organizationId })
        .from(schema.actions)
        .where(eq(schema.actions.id, item.id))
        .get();
      if (existing && existing.organizationId !== workspaceId) {
        throw new Error("Action item belongs to a different workspace.");
      }
      await tx
        .insert(schema.actions)
        .values({
          ...item,
          sourceId: item.sourceId ?? null,
          request: item.request ?? null,
          organizationId: workspaceId,
        })
        .onConflictDoUpdate({
          target: schema.actions.id,
          set: {
            agentId: item.agentId,
            title: item.title,
            reason: item.reason,
            sourceId: item.sourceId ?? null,
            request: item.request ?? null,
            status: item.status,
            createdAt: item.createdAt,
          },
        })
        .run();
    });
  }

  async dismissActionItem(workspaceId: string, id: string) {
    await this.ready;
    await this.db
      .update(schema.actions)
      .set({ status: "dismissed" })
      .where(
        and(
          eq(schema.actions.id, id),
          eq(schema.actions.organizationId, workspaceId),
        ),
      )
      .run();
  }

  async actionItem(workspaceId: string, id: string) {
    await this.ready;
    const item = await this.db
      .select()
      .from(schema.actions)
      .where(
        and(
          eq(schema.actions.id, id),
          eq(schema.actions.organizationId, workspaceId),
        ),
      )
      .get();
    return item
      ? {
          id: item.id,
          agentId: item.agentId,
          title: item.title,
          reason: item.reason,
          sourceId: item.sourceId ?? undefined,
          ...(item.request ? { request: item.request } : {}),
          status: item.status,
          createdAt: item.createdAt,
        }
      : null;
  }

  async dueRecurringWork(now: number) {
    await this.ready;
    return this.db
      .select()
      .from(schema.schedules)
      .where(
        and(
          eq(schema.schedules.status, "active"),
          // Cloud-placed automations fire in the deployment, never here.
          eq(schema.schedules.placement, "local"),
          lte(schema.schedules.nextAt, now),
          // An active row without a grant can never run; returning it would
          // make every tick fetch and skip it forever.
          isNotNull(schema.schedules.grant),
        ),
      )
      .all();
  }

  async listScheduleSessions(workspaceId: string): Promise<SessionRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.organizationId, workspaceId),
          isNotNull(schema.sessions.scheduleId),
        ),
      )
      .orderBy(desc(schema.sessions.startedAt))
      .all();
    return rows.map(sessionRecord);
  }

  async listActivitySessions(workspaceId: string): Promise<SessionRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.organizationId, workspaceId),
          or(
            eq(schema.sessions.kind, "task"),
            like(schema.sessions.id, "workspace-kickoff-%"),
            eq(schema.sessions.title, "Initial business review"),
          ),
        ),
      )
      .orderBy(desc(schema.sessions.updatedAt))
      .all();
    return rows.map(sessionRecord);
  }

  /**
   * A process exit cannot leave a real agent running. The sole runtime process
   * calls this after it owns the port, so every pre-existing running record is
   * interrupted and must be closed before new work is dispatched.
   */
  async reconcileInterruptedScheduleSessions(cutoff: number) {
    await this.ready;
    const interrupted = await this.db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.status, "running"),
          isNotNull(schema.sessions.scheduleId),
          lte(schema.sessions.startedAt, cutoff),
        ),
      )
      .all();
    let requeued = 0;
    for (const session of interrupted) {
      const sessionRequeued = await this.db.transaction(async (tx) => {
        const scheduleId = session.scheduleId;
        if (!scheduleId) return false;
        const transcriptRows = await tx
          .select()
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.organizationId, session.organizationId),
              eq(schema.messages.sessionId, session.id),
              gte(schema.messages.createdAt, session.startedAt ?? 0),
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
        const now = Date.now();
        const status = touchedTools ? "needs_approval" : "waiting";
        const summary = touchedTools
          ? "Chief restarted after this session used tools. It will not retry automatically."
          : RESTART_RETRY_SUMMARY;
        const closed = await tx
          .update(schema.sessions)
          .set({
            status,
            finishedAt: touchedTools ? now : null,
            summary: touchedTools ? RESTART_SESSION_SUMMARY : summary,
            error: RESTART_SESSION_ERROR,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.sessions.id, session.id),
              eq(schema.sessions.organizationId, session.organizationId),
              eq(schema.sessions.status, "running"),
            ),
          )
          .run();
        if (closed.rowsAffected === 0) return false;

        const work = await tx
          .select({
            status: schema.schedules.status,
          })
          .from(schema.schedules)
          .where(
            and(
              eq(schema.schedules.id, scheduleId),
              eq(schema.schedules.organizationId, session.organizationId),
            ),
          )
          .get();
        if (!work) return false;
        if (!touchedTools && work.status !== "active") return false;
        await tx
          .update(schema.schedules)
          .set({
            status: touchedTools ? "needs_approval" : "active",
            nextAt: touchedTools ? null : now + TRANSIENT_RETRY_DELAY_MS,
            lastSummary: summary,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.schedules.id, scheduleId),
              eq(schema.schedules.organizationId, session.organizationId),
            ),
          )
          .run();
        if (touchedTools) {
          const actionId = `action-${scheduleId}-interrupted`;
          const existingAction = await tx
            .select({ organizationId: schema.actions.organizationId })
            .from(schema.actions)
            .where(eq(schema.actions.id, actionId))
            .get();
          if (
            existingAction &&
            existingAction.organizationId !== session.organizationId
          ) {
            throw new Error("Action item belongs to a different workspace.");
          }
          await tx
            .insert(schema.actions)
            .values({
              id: actionId,
              organizationId: session.organizationId,
              agentId: "cmo",
              title: "Review interrupted work",
              reason: summary,
              sourceId: session.id,
              status: "open",
              createdAt: now,
            })
            .onConflictDoUpdate({
              target: schema.actions.id,
              set: {
                reason: summary,
                sourceId: session.id,
                status: "open",
                createdAt: now,
              },
            })
            .run();
        }
        return !touchedTools;
      });
      if (sessionRequeued) requeued += 1;
    }
    return { interrupted: interrupted.length, requeued };
  }

  async reconcileInterruptedSpecialistSessions(cutoff: number) {
    await this.ready;
    const now = Date.now();
    const result = await this.db
      .update(schema.sessions)
      .set({
        status: "failed",
        finishedAt: now,
        error:
          "Chief restarted while this local specialist was running. Retry with a new delegation ID if the work is still needed.",
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.sessions.kind, "task"),
          eq(schema.sessions.visibility, "private"),
          isNotNull(schema.sessions.parentId),
          isNull(schema.sessions.scheduleId),
          inArray(schema.sessions.provider, ["claude", "codex", "opencode"]),
          inArray(schema.sessions.status, ["running", "waiting"]),
          lte(schema.sessions.updatedAt, cutoff),
        ),
      )
      .run();
    return result.rowsAffected;
  }

  async reconcileStaleActivitySessions(cutoff: number) {
    await this.ready;
    const now = Date.now();
    const result = await this.db
      .update(schema.sessions)
      .set({
        status: "failed",
        finishedAt: now,
        error:
          "Chief lost contact with this work before it returned a final result.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(schema.sessions.status, ["running", "waiting"]),
          lte(schema.sessions.updatedAt, cutoff),
          or(
            and(
              eq(schema.sessions.kind, "task"),
              eq(schema.sessions.visibility, "private"),
              isNotNull(schema.sessions.parentId),
              isNull(schema.sessions.scheduleId),
            ),
            and(
              eq(schema.sessions.kind, "conversation"),
              like(schema.sessions.id, "workspace-kickoff-%"),
            ),
          ),
        ),
      )
      .run();
    return result.rowsAffected;
  }

  async finishSpecialistSession(
    workspaceId: string,
    sessionId: string,
    outcome:
      | { status: "completed"; result: string }
      | { status: "failed"; error: string },
    finishedAt: number,
  ) {
    await this.ready;
    const result = await this.db
      .update(schema.sessions)
      .set({
        status: outcome.status,
        finishedAt,
        summary: outcome.status === "completed" ? outcome.result : null,
        error: outcome.status === "failed" ? outcome.error : null,
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(schema.sessions.id, sessionId),
          eq(schema.sessions.organizationId, workspaceId),
          eq(schema.sessions.kind, "task"),
          eq(schema.sessions.visibility, "private"),
          isNotNull(schema.sessions.parentId),
          isNull(schema.sessions.scheduleId),
        ),
      )
      .run();
    if (result.rowsAffected === 0) {
      throw new Error("Specialist session could not be finalized.");
    }
  }

  /** Union of Executor addresses recent sessions of this schedule declined. */
  async latestSessionBlockedTools(
    workspaceId: string,
    scheduleId: string,
  ): Promise<string[]> {
    await this.ready;
    const rows = await this.db
      .select({ blockedTools: schema.sessions.blockedTools })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.organizationId, workspaceId),
          eq(schema.sessions.scheduleId, scheduleId),
        ),
      )
      .orderBy(desc(schema.sessions.startedAt))
      .limit(10)
      .all();
    return [...new Set(rows.flatMap((row) => row.blockedTools ?? []))];
  }

  async waitingScheduleSession(
    workspaceId: string,
    session: SessionRecord,
    work: RecurringWorkRecord,
  ) {
    await this.ready;
    if (
      session.scheduleId !== work.id ||
      session.status !== "waiting" ||
      session.finishedAt !== undefined ||
      work.nextAt === undefined
    ) {
      throw new Error("A waiting schedule session must match its retry.");
    }
    await this.db.transaction(async (tx) => {
      const waiting = await tx
        .update(schema.sessions)
        .set({
          status: "waiting",
          finishedAt: null,
          summary: session.summary,
          error: session.error,
          artifacts: session.artifacts ?? null,
          blockedTools: session.blockedTools ?? null,
          updatedAt: session.updatedAt,
        })
        .where(
          and(
            eq(schema.sessions.id, session.id),
            eq(schema.sessions.organizationId, workspaceId),
            eq(schema.sessions.scheduleId, work.id),
            eq(schema.sessions.status, "running"),
          ),
        )
        .run();
      if (waiting.rowsAffected === 0) {
        throw new Error("The active schedule session was not found.");
      }
      const saved = await tx
        .update(schema.schedules)
        .set({
          status: work.status,
          nextAt: work.nextAt,
          lastSummary: work.lastSummary,
          updatedAt: work.updatedAt,
        })
        .where(
          and(
            eq(schema.schedules.id, work.id),
            eq(schema.schedules.organizationId, workspaceId),
            eq(schema.schedules.status, "active"),
            isNotNull(schema.schedules.grant),
          ),
        )
        .run();
      if (saved.rowsAffected === 0) {
        throw new Error("The active recurring work definition was not found.");
      }
    });
  }

  async resumeScheduleSession(
    workspaceId: string,
    scheduleId: string,
    transition: {
      expectedNextAt: number;
      nextAt: number | null;
      startedAt: number;
    },
  ): Promise<SessionRecord | null> {
    await this.ready;
    try {
      return await this.db.transaction(async (tx) => {
        const waiting = await tx
          .select()
          .from(schema.sessions)
          .where(
            and(
              eq(schema.sessions.organizationId, workspaceId),
              eq(schema.sessions.scheduleId, scheduleId),
              eq(schema.sessions.status, "waiting"),
            ),
          )
          .orderBy(desc(schema.sessions.updatedAt))
          .get();
        if (!waiting) return null;
        const claimed = await tx
          .update(schema.schedules)
          .set({ nextAt: transition.nextAt, updatedAt: transition.startedAt })
          .where(
            and(
              eq(schema.schedules.id, scheduleId),
              eq(schema.schedules.organizationId, workspaceId),
              eq(schema.schedules.nextAt, transition.expectedNextAt),
              eq(schema.schedules.status, "active"),
              eq(schema.schedules.placement, "local"),
              isNotNull(schema.schedules.grant),
            ),
          )
          .run();
        if (claimed.rowsAffected === 0) {
          throw new ScheduleSessionClaimConflict();
        }
        const resumed = await tx
          .update(schema.sessions)
          .set({
            status: "running",
            startedAt: transition.startedAt,
            finishedAt: null,
            attempt: waiting.attempt + 1,
            error: null,
            updatedAt: transition.startedAt,
          })
          .where(
            and(
              eq(schema.sessions.id, waiting.id),
              eq(schema.sessions.organizationId, workspaceId),
              eq(schema.sessions.status, "waiting"),
            ),
          )
          .run();
        if (resumed.rowsAffected === 0) {
          throw new ScheduleSessionClaimConflict();
        }
        const row = await tx
          .select()
          .from(schema.sessions)
          .where(
            and(
              eq(schema.sessions.id, waiting.id),
              eq(schema.sessions.organizationId, workspaceId),
            ),
          )
          .get();
        if (!row) throw new ScheduleSessionClaimConflict();
        return sessionRecord(row);
      });
    } catch (error) {
      if (error instanceof ScheduleSessionClaimConflict) return null;
      throw error;
    }
  }

  async startScheduleSession(
    workspaceId: string,
    session: SessionRecord,
    transition?: {
      expectedNextAt?: number;
      nextAt: number | null;
    },
  ) {
    await this.ready;
    try {
      return await this.db.transaction(async (tx) => {
        const work = await tx
          .select({ conversationId: schema.schedules.conversationId })
          .from(schema.schedules)
          .where(
            and(
              eq(schema.schedules.id, session.scheduleId ?? ""),
              eq(schema.schedules.organizationId, workspaceId),
            ),
          )
          .get();
        if (!work) throw new Error("Schedule was not found in this workspace.");
        const activeSession = await tx
          .select({ id: schema.sessions.id })
          .from(schema.sessions)
          .where(
            and(
              eq(schema.sessions.organizationId, workspaceId),
              eq(schema.sessions.scheduleId, session.scheduleId ?? ""),
              inArray(schema.sessions.status, ["running", "waiting"]),
            ),
          )
          .get();
        if (activeSession) throw new ScheduleSessionClaimConflict();
        if (
          !session.scheduleId ||
          session.scheduledFor === undefined ||
          session.startedAt === undefined ||
          session.kind !== "task" ||
          session.visibility !== "private" ||
          session.agent !== "cmo" ||
          session.status !== "running"
        ) {
          throw new Error(
            "Schedule occurrences must be running private CMO task sessions.",
          );
        }
        if (session.parentId && session.parentId !== work.conversationId) {
          throw new Error(
            "Schedule session parent does not match its conversation.",
          );
        }
        if (session.parentId) {
          const parent = await tx
            .select({ organizationId: schema.sessions.organizationId })
            .from(schema.sessions)
            .where(eq(schema.sessions.id, session.parentId))
            .get();
          if (parent?.organizationId !== workspaceId) {
            throw new Error(
              "Schedule session parent belongs to a different workspace.",
            );
          }
        }
        if (transition) {
          const conditions = [
            eq(schema.schedules.id, session.scheduleId),
            eq(schema.schedules.organizationId, workspaceId),
          ];
          if (transition.expectedNextAt !== undefined) {
            conditions.push(
              eq(schema.schedules.nextAt, transition.expectedNextAt),
              eq(schema.schedules.status, "active"),
              eq(schema.schedules.placement, "local"),
              isNotNull(schema.schedules.grant),
            );
          }
          const claimed = await tx
            .update(schema.schedules)
            .set({
              nextAt: transition.nextAt,
              updatedAt: Date.now(),
            })
            .where(and(...conditions))
            .run();
          if (claimed.rowsAffected === 0) {
            throw new ScheduleSessionClaimConflict();
          }
        }
        const started = await tx
          .insert(schema.sessions)
          .values({
            ...session,
            organizationId: workspaceId,
            parentId: session.parentId,
            scheduleId: session.scheduleId,
            model: session.model,
            finishedAt: session.finishedAt,
            summary: session.summary,
            error: session.error,
            artifacts: session.artifacts,
            blockedTools: session.blockedTools,
          })
          .onConflictDoNothing()
          .run();
        if (started.rowsAffected === 0) {
          throw new ScheduleSessionClaimConflict();
        }
        return true;
      });
    } catch (error) {
      if (error instanceof ScheduleSessionClaimConflict) return false;
      throw error;
    }
  }

  async finishScheduleSession(
    workspaceId: string,
    session: SessionRecord,
    work: RecurringWorkRecord,
    actionTransition?: ScheduleSessionActionTransition,
  ) {
    await this.ready;
    if (
      session.scheduleId !== work.id ||
      session.finishedAt === undefined ||
      !["completed", "failed", "needs_approval"].includes(session.status)
    ) {
      throw new Error("A terminal schedule session must match its schedule.");
    }
    await this.db.transaction(async (tx) => {
      const finished = await tx
        .update(schema.sessions)
        .set({
          status: session.status,
          finishedAt: session.finishedAt,
          blockedTools: session.blockedTools ?? null,
          summary: session.summary,
          error: session.error,
          artifacts: session.artifacts ?? null,
          updatedAt: session.updatedAt,
        })
        .where(
          and(
            eq(schema.sessions.id, session.id),
            eq(schema.sessions.organizationId, workspaceId),
            eq(schema.sessions.scheduleId, work.id),
            eq(schema.sessions.status, "running"),
          ),
        )
        .run();
      if (finished.rowsAffected === 0) {
        throw new Error("The active schedule session was not found.");
      }
      const currentWork = await tx
        .select({
          status: schema.schedules.status,
          grant: schema.schedules.grant,
          nextAt: schema.schedules.nextAt,
          cron: schema.schedules.cron,
          timezone: schema.schedules.timezone,
          onceAt: schema.schedules.onceAt,
        })
        .from(schema.schedules)
        .where(
          and(
            eq(schema.schedules.id, work.id),
            eq(schema.schedules.organizationId, workspaceId),
          ),
        )
        .get();
      if (!currentWork) {
        throw new Error("The recurring work definition was not found.");
      }
      const userStoppedWork =
        currentWork.status === "paused" || currentWork.grant === null;
      const timingChanged =
        currentWork.cron !== work.cron ||
        currentWork.timezone !== work.timezone ||
        (currentWork.onceAt ?? undefined) !== work.onceAt;
      const saved = await tx
        .update(schema.schedules)
        .set({
          status: userStoppedWork ? currentWork.status : work.status,
          nextAt:
            userStoppedWork || timingChanged
              ? currentWork.nextAt
              : (work.nextAt ?? null),
          lastCompletedAt: work.lastCompletedAt,
          lastSummary: work.lastSummary,
          updatedAt: work.updatedAt,
        })
        .where(
          and(
            eq(schema.schedules.id, work.id),
            eq(schema.schedules.organizationId, workspaceId),
          ),
        )
        .run();
      if (saved.rowsAffected === 0)
        throw new Error("Recurring work was not saved.");

      if (actionTransition?.upsert) {
        const item = actionTransition.upsert;
        if (item.sourceId && !PRODUCT_ACTION_SOURCE.test(item.sourceId)) {
          const source = await tx
            .select({ organizationId: schema.sessions.organizationId })
            .from(schema.sessions)
            .where(eq(schema.sessions.id, item.sourceId))
            .get();
          if (source?.organizationId !== workspaceId) {
            throw new Error(
              "Action source session was not found in this workspace.",
            );
          }
        }
        const existing = await tx
          .select({ organizationId: schema.actions.organizationId })
          .from(schema.actions)
          .where(eq(schema.actions.id, item.id))
          .get();
        if (existing && existing.organizationId !== workspaceId) {
          throw new Error("Action item belongs to a different workspace.");
        }
        await tx
          .insert(schema.actions)
          .values({
            ...item,
            sourceId: item.sourceId ?? null,
            organizationId: workspaceId,
          })
          .onConflictDoUpdate({
            target: schema.actions.id,
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
      if (actionTransition?.dismissIds?.length) {
        await tx
          .update(schema.actions)
          .set({ status: "dismissed" })
          .where(
            and(
              eq(schema.actions.organizationId, workspaceId),
              inArray(schema.actions.id, actionTransition.dismissIds),
            ),
          )
          .run();
      }
    });
  }

  async saveDiagnosticEvent(
    workspaceId: string,
    sessionId: string,
    position: number,
    event: AgentEvent,
  ) {
    await this.ready;
    if (!Number.isSafeInteger(position) || position < 0) {
      throw new Error(
        "Diagnostic event position must be a non-negative integer.",
      );
    }
    const session = await this.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.id, sessionId),
          eq(schema.sessions.organizationId, workspaceId),
        ),
      )
      .get();
    if (!session) throw new Error("Session was not found in this workspace.");
    const data = diagnosticData(event);
    const level = diagnosticLevel(event);
    await this.db
      .insert(schema.events)
      .values({
        id: randomUUID(),
        organizationId: workspaceId,
        sessionId,
        position,
        type: event.type,
        level,
        data,
        createdAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [schema.events.sessionId, schema.events.position],
        set: { type: event.type, level, data },
      })
      .run();
  }

  async diagnostics(workspaceId: string): Promise<{
    sessions: SessionRecord[];
    events: DiagnosticEventRecord[];
  }> {
    await this.ready;
    const [sessionRows, eventRows] = await Promise.all([
      this.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.organizationId, workspaceId))
        .orderBy(desc(schema.sessions.updatedAt))
        .all(),
      this.db
        .select({
          id: schema.events.id,
          organizationId: schema.events.organizationId,
          sessionId: schema.events.sessionId,
          position: schema.events.position,
          type: schema.events.type,
          level: schema.events.level,
          data: schema.events.data,
          createdAt: schema.events.createdAt,
        })
        .from(schema.events)
        .innerJoin(
          schema.sessions,
          eq(schema.events.sessionId, schema.sessions.id),
        )
        .where(
          and(
            eq(schema.events.organizationId, workspaceId),
            eq(schema.sessions.organizationId, workspaceId),
          ),
        )
        .orderBy(schema.events.createdAt)
        .all(),
    ]);
    return {
      sessions: sessionRows.map(diagnosticSessionRecord),
      events: eventRows.map((event) => ({
        id: event.id,
        sessionId: event.sessionId,
        position: event.position,
        type: event.type,
        level: event.level,
        data: event.data,
        createdAt: event.createdAt,
      })),
    };
  }

  async listCampaigns(workspaceId: string): Promise<CampaignRecord[]> {
    await this.ready;
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.organizationId, workspaceId))
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
      .select({ organizationId: schema.campaigns.organizationId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .get();
    if (existing && existing.organizationId !== workspaceId) {
      throw new Error("Campaign belongs to a different workspace.");
    }
    await this.db
      .insert(schema.campaigns)
      .values({ ...campaign, organizationId: workspaceId })
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
      .where(eq(schema.agentPreferences.organizationId, workspaceId))
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
        organizationId: workspaceId,
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
          schema.agentPreferences.organizationId,
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
