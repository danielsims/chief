/* eslint-disable max-lines */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { ChatContext, LocalChatRecord } from "./local-store.js";
import type { SessionConfig } from "./session.js";
import type {
  ActionItem,
  AgentDefinition,
  AgentEvent,
  AgentPreference,
  AnalyticsDataset,
  CampaignRecord,
  ContentDraftRecord,
  DriverType,
  ProspectRecord,
  RecurringWorkRecord,
  ScheduleSessionActionTransition,
  SessionRecord,
  TrendRecord,
  WorkspaceFileSnapshot,
  WorkspaceFileWrite,
} from "./types.js";
import { LocalStore } from "./local-store.js";
import { runDateKey, upcomingRuns } from "./recurring-work.js";
import { AgentSession } from "./session.js";
import {
  assertWorkspaceTextContent,
  defaultWorkspaceFilePath,
  normalizeWorkspaceFilePath,
  removeWorkspaceFileContent,
  repairWorkspaceFileContent,
  stageWorkspaceFileContent,
} from "./workspace-files.js";
import { workspaceRoot, workspaceSecrets } from "./workspace-secrets.js";

function workspaceChatKey(workspaceId: string, chatId: string) {
  return `${workspaceId}\0${chatId}`;
}

const INITIAL_REVIEW_SINGLETON_AGENTS = new Set([
  "brand",
  "prospector",
  "setup",
]);

function sessionRank(status: SessionRecord["status"]) {
  return status === "completed"
    ? 4
    : status === "running" || status === "waiting"
      ? 3
      : status === "idle"
        ? 2
        : 1;
}

function preferredSession<
  T extends Pick<SessionRecord, "status" | "updatedAt">,
>(current: T | undefined, candidate: T) {
  if (!current) return candidate;
  const currentRank = sessionRank(current.status);
  const candidateRank = sessionRank(candidate.status);
  return candidateRank > currentRank ||
    (candidateRank === currentRank && candidate.updatedAt > current.updatedAt)
    ? candidate
    : current;
}

/**
 * One live session per workspace and chat. Provider continuation state lives
 * only on the durable chat; normalized messages are the history source of truth.
 */
export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private archivedEvents = new Map<string, AgentEvent[]>();
  private retainCounts = new Map<string, number>();
  private released = new Set<string>();
  private persistence = new Map<string, Promise<void>>();
  private creatingRootChats = new Map<
    string,
    Promise<LocalChatRecord | null>
  >();
  private startingSessions = new Map<string, Promise<AgentSession>>();
  private executionOwners = new Map<
    string,
    { id: string; owner: "interactive" | "schedule" | "channel" }
  >();
  /** Workspaces with a session mid-open, so their secrets must not lock. */
  private startingWorkspaces = new Map<string, number>();
  private readonly repairedFileWorkspaces = new Set<string>();

  constructor(readonly store = new LocalStore()) {}

  get(workspaceId: string, chatId: string) {
    return this.sessions.get(workspaceChatKey(workspaceId, chatId));
  }

  acquireExecution(
    workspaceId: string,
    chatId: string,
    owner: "interactive" | "schedule" | "channel",
  ) {
    const key = workspaceChatKey(workspaceId, chatId);
    const current = this.executionOwners.get(key);
    if (current || this.sessions.get(key)?.isBusy) {
      throw new Error(
        `This chat is already running ${current?.owner ?? "another"} work.`,
      );
    }
    const id = randomUUID();
    this.executionOwners.set(key, { id, owner });
    return () => {
      if (this.executionOwners.get(key)?.id === id) {
        this.executionOwners.delete(key);
      }
    };
  }

  assertExecutionAvailable(
    workspaceId: string,
    chatId: string,
    owner: "interactive" | "schedule" | "channel",
  ) {
    const current = this.executionOwners.get(
      workspaceChatKey(workspaceId, chatId),
    );
    if (current && current.owner !== owner) {
      throw new Error(`This chat is currently owned by ${current.owner} work.`);
    }
  }

  releaseExecution(
    workspaceId: string,
    chatId: string,
    owner: "interactive" | "schedule" | "channel",
  ) {
    const key = workspaceChatKey(workspaceId, chatId);
    if (this.executionOwners.get(key)?.owner === owner) {
      this.executionOwners.delete(key);
    }
  }

  assertInteractiveChat(workspaceId: string, chatId: string): Promise<void> {
    return Promise.resolve().then(() =>
      this.assertExecutionAvailable(workspaceId, chatId, "interactive"),
    );
  }

  health() {
    return this.store.health();
  }

  reconcileInterruptedSpecialistSessions(cutoff: number) {
    return this.store.reconcileInterruptedSpecialistSessions(cutoff);
  }

  reconcileStaleActivitySessions(cutoff: number) {
    return this.store.reconcileStaleActivitySessions(cutoff);
  }

  async ensureRootChat(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
    title = "",
  ): Promise<AgentSession> {
    await this.createRootChat(
      config.workspaceId,
      chatId,
      title,
      config.driver,
      config.model,
      agent.id,
    );
    return this.ensureSession(agent, chatId, config);
  }

  async switchRootChatExecution(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
  ): Promise<AgentSession> {
    const stored = await this.store.chatRecord(config.workspaceId, chatId);
    if (!stored) throw new Error("Session was not found in this workspace.");
    this.assertRootChat(stored);
    if (stored.provider === config.driver && stored.model === config.model) {
      return this.ensureSession(agent, chatId, config);
    }

    const key = workspaceChatKey(config.workspaceId, chatId);
    const existing = this.sessions.get(key);
    if (existing?.isBusy) {
      throw new Error(
        "Wait for the current response before changing agent app.",
      );
    }
    await (this.persistence.get(key) ?? Promise.resolve());
    if (existing) {
      this.archivedEvents.set(key, existing.events.slice(-500));
      this.sessions.delete(key);
      await existing.stop();
    }
    await this.store.updateChatState(config.workspaceId, chatId, {
      provider: config.driver,
      model: config.model ?? null,
      providerState: null,
      eveState: null,
      status: "idle",
    });
    return this.ensureSession(agent, chatId, config);
  }

  /**
   * Starts a fresh provider thread for an interrupted interactive chat while
   * preserving its durable Chief transcript. This is intentionally distinct
   * from changing provider/model: a half-finished tool call cannot be resumed
   * safely in the old provider thread after its local runtime disappeared.
   */
  async restartRootChatContinuation(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
  ): Promise<AgentSession> {
    const stored = await this.store.chatRecord(config.workspaceId, chatId);
    if (!stored) throw new Error("Session was not found in this workspace.");
    this.assertRootChat(stored);

    const key = workspaceChatKey(config.workspaceId, chatId);
    const existing = this.sessions.get(key);
    if (existing?.isBusy) {
      throw new Error("Wait for the current response before recovering it.");
    }
    await (this.persistence.get(key) ?? Promise.resolve());
    if (existing) {
      this.archivedEvents.set(key, existing.events.slice(-500));
      this.sessions.delete(key);
      await existing.stop();
    }
    await this.store.updateChatState(config.workspaceId, chatId, {
      providerState: null,
      eveState: null,
      status: "idle",
    });
    return this.ensureSession(agent, chatId, config);
  }

  async createRootChat(
    workspaceId: string,
    chatId: string,
    title: string,
    provider?: DriverType,
    model?: string,
    agentId = "cmo",
  ) {
    const key = workspaceChatKey(workspaceId, chatId);
    const pending = this.creatingRootChats.get(key);
    if (pending) return pending;
    const creation = this.createRootChatRecord(
      workspaceId,
      chatId,
      title,
      provider,
      model,
      agentId,
    ).finally(() => {
      if (this.creatingRootChats.get(key) === creation) {
        this.creatingRootChats.delete(key);
      }
    });
    this.creatingRootChats.set(key, creation);
    return creation;
  }

  private async createRootChatRecord(
    workspaceId: string,
    chatId: string,
    title: string,
    provider?: DriverType,
    model?: string,
    agentId = "cmo",
  ) {
    const stored = await this.store.chatRecord(workspaceId, chatId);
    if (!stored) {
      const preference = provider
        ? undefined
        : await this.store.agentPreference(workspaceId, "cmo");
      const driver = provider ?? preference?.driver;
      if (!driver) throw new Error("Configure the CMO agent app first.");
      await this.store.createChat({
        id: chatId,
        organizationId: workspaceId,
        kind: "conversation",
        visibility: "user",
        agent: agentId,
        provider: driver,
        model: model ?? preference?.model,
        title,
      });
    } else {
      this.assertRootChat(stored);
    }
    return this.store.chatRecord(workspaceId, chatId);
  }

  async ensureChildChat(
    agent: AgentDefinition,
    parentId: string,
    chatId: string,
    config: Omit<SessionConfig, "automationGrant">,
    metadata: { title?: string; triggerId?: string } = {},
  ): Promise<AgentSession> {
    if (agent.id === "cmo")
      throw new Error("Child chats require a specialist.");
    return this.ensureTaskSession(
      agent,
      parentId,
      chatId,
      {
        ...config,
        mcpServers: config.mcpServers ?? [],
        automationGrant: undefined,
        secretAccess: false,
      },
      metadata.title,
      metadata.triggerId,
    );
  }

  async ensureTaskSession(
    agent: AgentDefinition,
    parentId: string | undefined,
    sessionId: string,
    config: SessionConfig,
    title = "",
    triggerId?: string,
  ): Promise<AgentSession> {
    if (parentId) await this.rootChat(config.workspaceId, parentId);
    const stored = await this.store.chatRecord(config.workspaceId, sessionId);
    if (!stored) {
      if (agent.id === "cmo") {
        throw new Error(
          "CMO task sessions must be started atomically by a schedule.",
        );
      }
      if (!parentId)
        throw new Error("Specialist tasks require a conversation.");
      await this.store.createChat({
        id: sessionId,
        organizationId: config.workspaceId,
        parentId,
        triggerId,
        kind: "task",
        visibility: "private",
        agent: agent.id,
        provider: config.driver,
        model: config.model,
        title,
      });
    } else if (
      stored.kind !== "task" ||
      stored.visibility !== "private" ||
      stored.parentId !== parentId ||
      stored.agent !== agent.id
    ) {
      throw new Error("Task session identity does not match stored state.");
    } else if (agent.id === "cmo" && !stored.scheduleId) {
      throw new Error("CMO task sessions must belong to a schedule.");
    }
    return this.ensureSession(agent, sessionId, config);
  }

  private async ensureSession(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
  ): Promise<AgentSession> {
    const key = workspaceChatKey(config.workspaceId, chatId);
    const starting = this.startingSessions.get(key);
    if (starting) {
      await starting;
      return this.ensureSession(agent, chatId, config);
    }
    const start = this.startSession(agent, chatId, config);
    const tracked = start.finally(() => {
      if (this.startingSessions.get(key) === tracked) {
        this.startingSessions.delete(key);
      }
    });
    this.startingSessions.set(key, tracked);
    return tracked;
  }

  private async startSession(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
  ): Promise<AgentSession> {
    await this.repairWorkspaceFiles(config.workspaceId);
    const key = workspaceChatKey(config.workspaceId, chatId);
    const storedChat = await this.store.chatRecord(config.workspaceId, chatId);
    if (!storedChat)
      throw new Error("Session was not found in this workspace.");
    const conversationId =
      storedChat.kind === "conversation" ? storedChat.id : storedChat.parentId;
    const runtimeContext = [
      `Runtime context: the current Chief session ID is ${chatId}. Pass this exact value as sourceId whenever you call action.raise.`,
      conversationId
        ? `The owning Chief conversation ID is ${conversationId}. Pass this exact value as conversationId whenever you propose scheduled work or open Chief's embedded browser.`
        : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    const runtimeAgent = agent.instructions.includes(
      `Runtime context: the current Chief session ID is ${chatId}.`,
    )
      ? agent
      : {
          ...agent,
          instructions: `${agent.instructions}\n\n${runtimeContext}`,
        };
    const existing = this.sessions.get(key);
    if (existing) {
      // A live session can't hop backends or change its access level.
      if (
        existing.config.driver !== config.driver ||
        existing.config.access !== config.access ||
        existing.config.workspaceId !== config.workspaceId ||
        existing.config.model !== config.model ||
        existing.agent.instructions !== runtimeAgent.instructions ||
        existing.config.executionOwner !== config.executionOwner ||
        JSON.stringify(existing.config.mcpServers ?? []) !==
          JSON.stringify(config.mcpServers ?? [])
      ) {
        if (existing.isBusy) {
          throw new Error(
            `This chat is busy with ${existing.config.executionOwner ?? "interactive"} work and cannot be replaced.`,
          );
        }
        await existing.stop();
        this.sessions.delete(key);
      } else {
        return existing;
      }
    }
    await (this.persistence.get(key) ?? Promise.resolve());

    // Mark the workspace as starting before any await so a concurrently
    // closing session can't lock (delete) its secrets mid-materialize.
    this.startingWorkspaces.set(
      config.workspaceId,
      (this.startingWorkspaces.get(config.workspaceId) ?? 0) + 1,
    );
    let env: Record<string, string>;
    try {
      env =
        config.secretAccess === false
          ? {}
          : await workspaceSecrets.materialize(config.workspaceId);
    } finally {
      const remaining =
        (this.startingWorkspaces.get(config.workspaceId) ?? 1) - 1;
      if (remaining > 0) {
        this.startingWorkspaces.set(config.workspaceId, remaining);
      } else {
        this.startingWorkspaces.delete(config.workspaceId);
      }
    }
    const scopedConfig = { ...config, env, runtimeContext };
    const archivedKey = workspaceChatKey(config.workspaceId, chatId);
    const storedEvents =
      this.archivedEvents.get(archivedKey) ??
      (await this.store.transcript(config.workspaceId, chatId));
    let diagnosticPosition = (
      await this.store.diagnostics(config.workspaceId)
    ).events
      .filter((event) => event.sessionId === chatId)
      .reduce((next, event) => Math.max(next, event.position + 1), 0);
    const session = new AgentSession(
      runtimeAgent,
      chatId,
      scopedConfig,
      storedEvents,
    );
    this.sessions.set(key, session);

    session.on("event", (event: AgentEvent) => {
      const position = diagnosticPosition++;
      const persistence = (this.persistence.get(key) ?? Promise.resolve())
        .then(async () => {
          try {
            await this.store.saveDiagnosticEvent(
              config.workspaceId,
              chatId,
              position,
              event,
            );
          } catch (error) {
            console.error("[local-store] diagnostic:", error);
          }
          if (event.type === "init") {
            await this.store.updateChatState(config.workspaceId, chatId, {
              ...(config.driver === "remote"
                ? {}
                : { providerState: { sessionId: event.sessionId } }),
            });
          }
          if (event.type === "status" && !storedChat.scheduleId) {
            await this.store.updateChatState(config.workspaceId, chatId, {
              status: event.status === "error" ? "failed" : event.status,
            });
          }
          if (
            event.type === "message" ||
            event.type === "result" ||
            event.type === "error" ||
            event.type === "permissionResolved"
          ) {
            await this.store.saveTranscript(
              {
                id: chatId,
                organizationId: config.workspaceId,
                agentId: storedChat.agent,
                driver: config.driver,
                model: config.model,
                parentId: storedChat.parentId,
                triggerId: storedChat.triggerId,
                scheduleId: storedChat.scheduleId,
                kind: storedChat.kind,
                visibility: storedChat.visibility,
                providerState: session.sessionId
                  ? { sessionId: session.sessionId }
                  : undefined,
                eveState: session.driverState,
                scheduledFor: storedChat.scheduledFor,
                startedAt: storedChat.startedAt,
                finishedAt: storedChat.finishedAt,
                attempt: storedChat.attempt,
                summary: storedChat.summary,
                error: storedChat.error,
                artifacts: storedChat.artifacts,
                blockedTools: storedChat.blockedTools,
              },
              session.events,
            );
          }
        })
        .catch((error) => console.error("[local-store] persistence:", error));
      this.persistence.set(key, persistence);
      if (event.type === "exit") {
        this.archivedEvents.set(archivedKey, session.events.slice(-500));
        if (this.sessions.get(key) === session) {
          this.sessions.delete(key);
        }
        this.lockWorkspaceIfInactive(config.workspaceId);
      }
      if (
        this.released.has(key) &&
        (event.type === "result" ||
          event.type === "error" ||
          (event.type === "status" && event.status === "idle"))
      ) {
        void this.stopReleased(config.workspaceId, chatId);
      }
    });

    session.on("state", (state: unknown) => {
      const persistence = (this.persistence.get(key) ?? Promise.resolve())
        .then(async () => {
          await this.store.updateChatState(config.workspaceId, chatId, {
            eveState: state,
          });
        })
        .catch((error) =>
          console.error("[local-store] driver state persistence:", error),
        );
      this.persistence.set(key, persistence);
    });

    const cwd =
      storedChat.kind === "task" && !storedChat.scheduleId
        ? join(
            workspaceRoot(config.workspaceId),
            "agents",
            agent.id,
            "sessions",
            chatId,
          )
        : join(workspaceRoot(config.workspaceId), "agents", agent.id);
    mkdirSync(cwd, { recursive: true });
    const continuation =
      storedChat.provider === config.driver &&
      storedChat.providerState &&
      typeof storedChat.providerState === "object" &&
      "sessionId" in storedChat.providerState &&
      typeof storedChat.providerState.sessionId === "string"
        ? storedChat.providerState.sessionId
        : undefined;
    try {
      await session.start(
        cwd,
        continuation,
        storedChat.provider === config.driver ? storedChat.eveState : undefined,
      );
    } catch (error) {
      if (this.sessions.get(key) === session) {
        this.sessions.delete(key);
      }
      await session.stop().catch(() => undefined);
      this.lockWorkspaceIfInactive(config.workspaceId);
      throw error;
    }
    return session;
  }

  retain(workspaceId: string, chatId: string) {
    const key = workspaceChatKey(workspaceId, chatId);
    this.released.delete(key);
    this.retainCounts.set(key, (this.retainCounts.get(key) ?? 0) + 1);
  }

  async release(workspaceId: string, chatId: string) {
    const key = workspaceChatKey(workspaceId, chatId);
    const next = Math.max(0, (this.retainCounts.get(key) ?? 1) - 1);
    if (next > 0) {
      this.retainCounts.set(key, next);
      return;
    }
    this.retainCounts.delete(key);
    this.released.add(key);
    await this.stopReleased(workspaceId, chatId);
  }

  private async stopReleased(workspaceId: string, chatId: string) {
    const key = workspaceChatKey(workspaceId, chatId);
    const session = this.sessions.get(key);
    if (!session || session.isBusy || !this.released.has(key)) return;
    this.archivedEvents.set(
      workspaceChatKey(session.config.workspaceId, chatId),
      session.events.slice(-500),
    );
    this.sessions.delete(key);
    this.released.delete(key);
    this.executionOwners.delete(key);
    await session.stop();
    this.lockWorkspaceIfInactive(session.config.workspaceId);
  }

  async remove(workspaceId: string, chatId: string) {
    await this.assertInteractiveChat(workspaceId, chatId);
    await this.rootChat(workspaceId, chatId);
    const key = workspaceChatKey(workspaceId, chatId);
    const session = this.sessions.get(key);
    this.sessions.delete(key);
    this.archivedEvents.delete(workspaceChatKey(workspaceId, chatId));
    this.retainCounts.delete(key);
    this.released.delete(key);
    this.executionOwners.delete(key);
    await this.store.deleteChat(workspaceId, chatId);
    await session?.stop();
    if (session) this.lockWorkspaceIfInactive(session.config.workspaceId);
  }

  async listChats(workspaceId: string) {
    return (await this.store.listChats(workspaceId)).map((chat) => ({
      ...chat,
      running:
        this.sessions.get(workspaceChatKey(workspaceId, chat.id))?.isBusy ??
        false,
    }));
  }

  messages(workspaceId: string, chatId: string) {
    return this.store.uiMessages(workspaceId, chatId);
  }

  chat(workspaceId: string, chatId: string) {
    return this.store.chat(workspaceId, chatId);
  }

  async inspectChat(workspaceId: string, chatId: string) {
    const chat = await this.store.chatRecord(workspaceId, chatId);
    if (!chat) throw new Error("Chat was not found in this workspace.");
    if (chat.parentId && chat.visibility !== "private") {
      throw new Error("Stored child chat is not private.");
    }
    const session = this.get(workspaceId, chatId);
    return {
      chat,
      session,
      events:
        session?.events ?? (await this.store.transcript(workspaceId, chatId)),
    };
  }

  async rootChat(workspaceId: string, chatId: string) {
    const inspected = await this.inspectChat(workspaceId, chatId);
    this.assertRootChat(inspected.chat);
    return inspected;
  }

  async childChats(workspaceId: string, rootChatId: string) {
    const root = await this.rootChat(workspaceId, rootChatId);
    const chats = (
      await this.store.listChildChats(workspaceId, rootChatId)
    ).filter((chat) => !chat.scheduleId);
    if (
      !rootChatId.startsWith("workspace-kickoff-") &&
      root.chat.title !== "Initial business review"
    ) {
      return chats;
    }
    const preferred = new Map<string, (typeof chats)[number]>();
    for (const chat of chats) {
      if (!INITIAL_REVIEW_SINGLETON_AGENTS.has(chat.agent)) continue;
      preferred.set(
        chat.agent,
        preferredSession(preferred.get(chat.agent), chat),
      );
    }
    return chats.filter(
      (chat) =>
        !INITIAL_REVIEW_SINGLETON_AGENTS.has(chat.agent) ||
        chat.id === preferred.get(chat.agent)?.id,
    );
  }

  async startChildChat(workspaceId: string, chatId: string) {
    const inspected = await this.inspectChat(workspaceId, chatId);
    if (
      inspected.chat.kind !== "task" ||
      inspected.chat.visibility !== "private" ||
      !inspected.chat.parentId ||
      inspected.chat.scheduleId
    ) {
      throw new Error("Only delegated specialist sessions can start here.");
    }
    await this.store.updateChatState(workspaceId, chatId, {
      status: "running",
      startedAt: inspected.chat.startedAt ?? Date.now(),
    });
  }

  async finishChildChat(
    workspaceId: string,
    chatId: string,
    outcome:
      | { status: "completed"; result: string }
      | { status: "failed"; error: string },
  ) {
    const inspected = await this.inspectChat(workspaceId, chatId);
    if (
      inspected.chat.kind !== "task" ||
      inspected.chat.visibility !== "private" ||
      !inspected.chat.parentId ||
      inspected.chat.scheduleId
    ) {
      throw new Error("Only delegated specialist sessions can finish here.");
    }
    await this.waitForChatPersistence(workspaceId, chatId);
    await this.stopRuntimeChat(workspaceId, chatId);
    const finishedAt = Date.now();
    await this.store.finishSpecialistSession(
      workspaceId,
      chatId,
      outcome,
      finishedAt,
    );
    await this.store.saveTranscript(
      {
        id: chatId,
        organizationId: workspaceId,
        agentId: inspected.chat.agent,
        driver: inspected.chat.provider as DriverType,
        model: inspected.chat.model,
        parentId: inspected.chat.parentId,
        triggerId: inspected.chat.triggerId,
        kind: "task",
        visibility: "private",
        status: outcome.status,
        startedAt: inspected.chat.startedAt ?? inspected.chat.createdAt,
        finishedAt,
        attempt: inspected.chat.attempt,
        summary: outcome.status === "completed" ? outcome.result : undefined,
        error: outcome.status === "failed" ? outcome.error : undefined,
      },
      inspected.events,
      inspected.chat.title,
    );
  }

  private assertRootChat(chat: LocalChatRecord) {
    if (
      chat.parentId ||
      chat.kind !== "conversation" ||
      chat.visibility !== "user"
    ) {
      throw new Error(
        "Only a top-level user-visible Chief chat is composable.",
      );
    }
  }

  waitForChatPersistence(workspaceId: string, chatId: string) {
    return (
      this.persistence.get(workspaceChatKey(workspaceId, chatId)) ??
      Promise.resolve()
    );
  }

  async stopRuntimeChat(workspaceId: string, chatId: string) {
    const key = workspaceChatKey(workspaceId, chatId);
    const session = this.sessions.get(key);
    if (!session) return;
    await (this.persistence.get(key) ?? Promise.resolve());
    this.archivedEvents.set(key, session.events.slice(-500));
    this.sessions.delete(key);
    this.retainCounts.delete(key);
    this.released.delete(key);
    await session.stop();
    this.lockWorkspaceIfInactive(workspaceId);
  }

  async workspaceData(workspaceId: string) {
    const [
      prospects,
      trends,
      analyticsDatasets,
      drafts,
      campaigns,
      recurringWork,
      activity,
      actionItems,
    ] = await Promise.all([
      this.store.listProspects(workspaceId),
      this.store.listTrends(workspaceId),
      this.store.listAnalyticsDatasets(workspaceId),
      this.store.listDrafts(workspaceId),
      this.store.listCampaigns(workspaceId),
      this.store.listRecurringWork(workspaceId),
      this.store.listActivitySessions(workspaceId),
      this.store.listActionItems(workspaceId),
    ]);
    const initialReviewIds = new Set(
      activity
        .filter(
          (session) =>
            !session.parentId &&
            (session.id.startsWith("workspace-kickoff-") ||
              session.title === "Initial business review"),
        )
        .map((session) => session.id),
    );
    const initialSingletonSessions = new Map<string, SessionRecord>();
    const visibleActivity = activity.filter((session) => {
      if (
        !INITIAL_REVIEW_SINGLETON_AGENTS.has(session.agent) ||
        !session.parentId ||
        (!session.parentId.startsWith("workspace-kickoff-") &&
          !initialReviewIds.has(session.parentId)) ||
        session.scheduleId
      ) {
        return true;
      }
      const key = `${session.parentId}\0${session.agent}`;
      const current = initialSingletonSessions.get(key);
      initialSingletonSessions.set(key, preferredSession(current, session));
      return false;
    });
    visibleActivity.push(...initialSingletonSessions.values());
    return {
      prospects,
      trends,
      analyticsDatasets,
      drafts,
      campaigns,
      activity: visibleActivity,
      actionItems,
      recurringWork: recurringWork.map((work) => {
        try {
          const skipped = new Set(work.skipDates ?? []);
          const persisted = work.nextAt;
          const projected =
            work.onceAt !== undefined
              ? []
              : upcomingRuns(work.cron, work.timezone).filter(
                  (timestamp) =>
                    !skipped.has(runDateKey(timestamp, work.timezone)) &&
                    (persisted === undefined || timestamp > persisted),
                );
          return {
            ...work,
            upcomingRuns: [
              ...(persisted === undefined ? [] : [persisted]),
              ...projected,
            ],
          };
        } catch {
          return {
            ...work,
            upcomingRuns: work.nextAt === undefined ? [] : [work.nextAt],
          };
        }
      }),
    };
  }

  saveProspect(workspaceId: string, prospect: ProspectRecord) {
    return this.store.saveProspect(workspaceId, prospect);
  }

  saveTrend(workspaceId: string, trend: TrendRecord) {
    return this.store.saveTrend(workspaceId, trend);
  }

  saveAnalyticsDataset(
    workspaceId: string,
    dataset: Omit<AnalyticsDataset, "capturedAt">,
  ) {
    return this.store.saveAnalyticsDataset(workspaceId, dataset);
  }

  saveDraft(workspaceId: string, draft: ContentDraftRecord) {
    return this.store.saveDraft(workspaceId, draft);
  }

  listWorkspaceFiles(workspaceId: string) {
    return this.store.listWorkspaceFiles(workspaceId);
  }

  workspaceFile(workspaceId: string, fileId: string) {
    return this.store.workspaceFile(workspaceId, fileId).then((file) => {
      if (file) {
        repairWorkspaceFileContent(
          workspaceId,
          file.path,
          file.currentVersionId,
          file.content,
        );
      }
      return file;
    });
  }

  private async repairWorkspaceFiles(workspaceId: string) {
    if (this.repairedFileWorkspaces.has(workspaceId)) return;
    for (const record of await this.store.listWorkspaceFiles(workspaceId)) {
      const file = await this.store.workspaceFile(workspaceId, record.id);
      if (!file) continue;
      repairWorkspaceFileContent(
        workspaceId,
        file.path,
        file.currentVersionId,
        file.content,
      );
    }
    this.repairedFileWorkspaces.add(workspaceId);
  }

  async saveWorkspaceFile(workspaceId: string, input: WorkspaceFileWrite) {
    const existing = input.id
      ? await this.store.workspaceFile(workspaceId, input.id)
      : null;
    if (input.id && !existing) throw new Error("File not found.");
    if (
      existing &&
      input.expectedVersionId &&
      existing.currentVersionId !== input.expectedVersionId
    ) {
      throw new Error("FILE_VERSION_CONFLICT");
    }
    const content = input.content.replaceAll("\r\n", "\n");
    assertWorkspaceTextContent(content);
    const kind = input.kind ?? existing?.kind ?? "document";
    const requestedName = input.name.trim().slice(0, 160);
    const name =
      requestedName.length > 0 ? requestedName : (existing?.name ?? "Untitled");
    const path = normalizeWorkspaceFilePath(
      input.path ?? existing?.path ?? defaultWorkspaceFilePath(name, kind),
    );
    const collision = (await this.store.listWorkspaceFiles(workspaceId)).find(
      (file) => file.path === path && file.id !== existing?.id,
    );
    if (collision) throw new Error("A file already exists at this path.");

    const now = Date.now();
    const id = existing?.id ?? randomUUID();
    const versionId = randomUUID();
    const file: WorkspaceFileSnapshot = {
      id,
      name,
      path,
      mimeType: input.mimeType ?? existing?.mimeType ?? "text/markdown",
      kind,
      provider: "local",
      currentVersionId: versionId,
      createdBy: existing?.createdBy ?? input.createdBy,
      sourceAgentId: input.sourceAgentId ?? existing?.sourceAgentId,
      sourceSessionId: input.sourceSessionId ?? existing?.sourceSessionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      content,
    };
    const staged = stageWorkspaceFileContent(
      workspaceId,
      path,
      id,
      versionId,
      content,
    );
    try {
      await this.store.saveWorkspaceFile(
        workspaceId,
        file,
        input.expectedVersionId,
      );
    } catch (error) {
      staged.discard();
      throw error;
    }
    staged.commit();
    return file;
  }

  async deleteWorkspaceFile(workspaceId: string, fileId: string) {
    const file = await this.store.workspaceFile(workspaceId, fileId);
    if (!file) return;
    await this.store.deleteWorkspaceFile(workspaceId, fileId);
    removeWorkspaceFileContent(workspaceId, file.path, file.id);
  }

  saveCampaign(workspaceId: string, campaign: CampaignRecord) {
    return this.store.saveCampaign(workspaceId, campaign);
  }

  recurringWorkById(workspaceId: string, id: string) {
    return this.store.recurringWorkById(workspaceId, id);
  }

  saveRecurringWork(workspaceId: string, work: RecurringWorkRecord) {
    return this.store.saveRecurringWork(workspaceId, work);
  }

  dueRecurringWork(now: number) {
    return this.store.dueRecurringWork(now);
  }

  saveTranscript(
    context: ChatContext,
    events: AgentEvent[],
    titleOverride?: string,
  ) {
    return this.store.saveTranscript(context, events, titleOverride);
  }

  transcript(workspaceId: string, chatId: string) {
    return this.store.transcript(workspaceId, chatId);
  }

  raiseActionItem(workspaceId: string, item: ActionItem) {
    return this.store.raiseActionItem(workspaceId, item);
  }

  dismissActionItem(workspaceId: string, id: string) {
    return this.store.dismissActionItem(workspaceId, id);
  }

  actionItem(workspaceId: string, id: string) {
    return this.store.actionItem(workspaceId, id);
  }

  diagnostics(workspaceId: string) {
    return this.store.diagnostics(workspaceId);
  }

  latestSessionBlockedTools(workspaceId: string, recurringWorkId: string) {
    return this.store.latestSessionBlockedTools(workspaceId, recurringWorkId);
  }

  deleteRecurringWork(workspaceId: string, id: string) {
    return this.store.deleteRecurringWork(workspaceId, id);
  }

  startScheduleSession(
    workspaceId: string,
    session: SessionRecord,
    transition?: { expectedNextAt?: number; nextAt: number | null },
  ) {
    return this.store.startScheduleSession(workspaceId, session, transition);
  }

  waitingScheduleSession(
    workspaceId: string,
    session: SessionRecord,
    work: RecurringWorkRecord,
  ) {
    return this.store.waitingScheduleSession(workspaceId, session, work);
  }

  resumeScheduleSession(
    workspaceId: string,
    scheduleId: string,
    transition: {
      expectedNextAt: number;
      nextAt: number | null;
      startedAt: number;
    },
  ) {
    return this.store.resumeScheduleSession(
      workspaceId,
      scheduleId,
      transition,
    );
  }

  finishScheduleSession(
    workspaceId: string,
    session: SessionRecord,
    work: RecurringWorkRecord,
    actionTransition?: ScheduleSessionActionTransition,
  ) {
    return this.store.finishScheduleSession(
      workspaceId,
      session,
      work,
      actionTransition,
    );
  }

  reconcileInterruptedScheduleSessions(cutoff: number) {
    return this.store.reconcileInterruptedScheduleSessions(cutoff);
  }

  agentPreference(workspaceId: string, agentId: string) {
    return this.store.agentPreference(workspaceId, agentId);
  }

  listAgentPreferences(workspaceId: string) {
    return this.store.listAgentPreferences(workspaceId);
  }

  saveAgentPreference(workspaceId: string, preference: AgentPreference) {
    return this.store.saveAgentPreference(workspaceId, preference);
  }

  async stopAll() {
    await this.stopSessions();
    await Promise.all(this.persistence.values());
    this.sessions.clear();
    this.executionOwners.clear();
    workspaceSecrets.lockAll();
    await this.store.close();
  }

  async stopSessions() {
    await Promise.all(
      [...this.sessions.values()].map((session) => session.stop()),
    );
  }

  private lockWorkspaceIfInactive(workspaceId: string) {
    const active =
      (this.startingWorkspaces.get(workspaceId) ?? 0) > 0 ||
      [...this.sessions.values()].some(
        (session) => session.config.workspaceId === workspaceId,
      );
    if (!active) void workspaceSecrets.lock(workspaceId);
  }
}
