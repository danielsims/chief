import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { AgentSession, type SessionConfig } from "./session.js";
import type { AgentDefinition, AgentEvent } from "./types.js";

const HOME = join(homedir(), ".marketer");

interface PersistedSession {
  agentId: string;
  sessionId: string;
  driver?: string;
}

/**
 * One live session per chatId. Backend-native session ids are persisted to
 * ~/.marketer/sessions.json so chats resume across service restarts — the
 * CLI's own transcripts remain the source of truth for history.
 */
export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private archivedEvents = new Map<string, AgentEvent[]>();
  private retainCounts = new Map<string, number>();
  private released = new Set<string>();
  private persisted: Record<string, PersistedSession> = {};

  constructor() {
    mkdirSync(HOME, { recursive: true });
    const file = join(HOME, "sessions.json");
    if (existsSync(file)) {
      try {
        this.persisted = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        this.persisted = {};
      }
    }
  }

  get(chatId: string) {
    return this.sessions.get(chatId);
  }

  async ensure(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(chatId);
    if (existing) {
      // A live session can't hop backends or change its access level.
      if (
        existing.config.driver !== config.driver ||
        existing.config.access !== config.access ||
        JSON.stringify(existing.config.mcpServers ?? []) !==
          JSON.stringify(config.mcpServers ?? [])
      ) {
        await existing.stop();
        this.sessions.delete(chatId);
      } else {
        return existing;
      }
    }

    const session = new AgentSession(
      agent,
      chatId,
      config,
      this.archivedEvents.get(chatId),
    );
    this.sessions.set(chatId, session);

    session.on("event", (event) => {
      if (event.type === "init") {
        this.persisted[chatId] = {
          agentId: agent.id,
          sessionId: event.sessionId,
          driver: config.driver,
        };
        this.save();
      }
      if (event.type === "exit") {
        this.archivedEvents.set(chatId, session.events.slice(-500));
        if (this.sessions.get(chatId) === session) {
          this.sessions.delete(chatId);
        }
      }
      if (
        this.released.has(chatId) &&
        (event.type === "result" ||
          event.type === "error" ||
          (event.type === "status" && event.status === "idle"))
      ) {
        void this.stopReleased(chatId);
      }
    });

    const cwd = join(HOME, "agents", agent.id);
    mkdirSync(cwd, { recursive: true });
    // Session ids don't transfer across backends — only resume same-driver.
    const prev = this.persisted[chatId];
    const resume =
      prev && prev.driver === config.driver ? prev.sessionId : undefined;
    await session.start(cwd, resume);
    return session;
  }

  retain(chatId: string) {
    this.released.delete(chatId);
    this.retainCounts.set(chatId, (this.retainCounts.get(chatId) ?? 0) + 1);
  }

  async release(chatId: string) {
    const next = Math.max(0, (this.retainCounts.get(chatId) ?? 1) - 1);
    if (next > 0) {
      this.retainCounts.set(chatId, next);
      return;
    }
    this.retainCounts.delete(chatId);
    this.released.add(chatId);
    await this.stopReleased(chatId);
  }

  private async stopReleased(chatId: string) {
    const session = this.sessions.get(chatId);
    if (!session || session.isBusy || !this.released.has(chatId)) return;
    this.archivedEvents.set(chatId, session.events.slice(-500));
    this.sessions.delete(chatId);
    this.released.delete(chatId);
    await session.stop();
  }

  async remove(chatId: string) {
    const session = this.sessions.get(chatId);
    this.sessions.delete(chatId);
    this.archivedEvents.delete(chatId);
    this.retainCounts.delete(chatId);
    this.released.delete(chatId);
    delete this.persisted[chatId];
    this.save();
    await session?.stop();
  }

  async stopAll() {
    await Promise.all([...this.sessions.values()].map((s) => s.stop()));
    this.sessions.clear();
  }

  private save() {
    writeFileSync(
      join(HOME, "sessions.json"),
      JSON.stringify(this.persisted, null, 2),
    );
  }
}
