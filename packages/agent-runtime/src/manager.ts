import { randomUUID } from "node:crypto";

import type { LocalChatRecord } from "./local-store.js";
import type { ActiveAgentSessionIdentity } from "./manager-execution-ownership.js";
import type { AgentSession, SessionConfig } from "./session.js";
import type {
  AgentDefinition,
  AgentEvent,
  AgentToolPermission,
  DriverType,
} from "./types.js";
import { parseDriverType } from "./drivers/driver-type.js";
import { LocalStore } from "./local-store.js";
import {
  resolveActiveAgentSession,
  workspaceChatKey,
} from "./manager-execution-ownership.js";
import { ManagerWorkspaceStore } from "./manager-workspace-store.js";
import { startManagedSession } from "./session-starter.js";
import {
  hasInitialReviewKickoff,
  INITIAL_REVIEW_SINGLETON_AGENTS,
  preferredSession,
} from "./workspace-data.js";
import { workspaceSecrets } from "./workspace-secrets.js";

export {
  resolveActiveAgentSession,
  type ActiveAgentSessionIdentity,
} from "./manager-execution-ownership.js";

/**
 * One live session per workspace and chat. Provider continuation state lives
 * only on the durable chat; normalized messages are the history source of truth.
 */
export class SessionManager extends ManagerWorkspaceStore {
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
  private executionWaiters = new Map<string, Set<() => void>>();
  /** Workspaces with a session mid-open, so their secrets must not lock. */
  private startingWorkspaces = new Map<string, number>();
  private sessionEnvironmentProvider?: (input: {
    workspaceId: string;
    agentId: string;
    sessionId: string;
    localToolPermissions?: readonly AgentToolPermission[];
  }) => Record<string, string>;

  constructor(store = new LocalStore()) {
    super(store);
  }

  /**
   * Supplies host-owned, short-lived session material. The runtime uses this
   * for agent-bound Chief CLI credentials; callers never persist the secret.
   */
  setSessionEnvironmentProvider(
    provider: NonNullable<SessionManager["sessionEnvironmentProvider"]>,
  ) {
    this.sessionEnvironmentProvider = provider;
  }

  get(workspaceId: string, chatId: string) {
    return this.sessions.get(workspaceChatKey(workspaceId, chatId));
  }
  executionOwner(workspaceId: string, chatId: string) {
    return this.executionOwners.get(workspaceChatKey(workspaceId, chatId))
      ?.owner;
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
        this.notifyExecutionWaiters(key);
      }
    };
  }

  private notifyExecutionWaiters(key: string) {
    for (const notify of this.executionWaiters.get(key) ?? []) notify();
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

  /**
   * Wait until a chat's current execution finishes, then resolve. Used to
   * queue a user message that arrives while a turn (for example a browser
   * setup handoff) is still running, so the reply is not rejected outright.
   * Re-checks after each terminal event in case another turn (for example the
   * setup auto-resume) immediately starts, and gives up after an overall bound
   * so a hung session cannot block the message forever.
   */
  async waitForExecutionAvailability(
    workspaceId: string,
    chatId: string,
    timeoutMs = 10 * 60_000,
  ): Promise<void> {
    const key = workspaceChatKey(workspaceId, chatId);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = this.sessions.get(key);
      if (!this.executionOwners.has(key) && !current?.isBusy) return;
      await new Promise<void>((resolve) => {
        const remaining = Math.max(1, deadline - Date.now());
        const waiters = this.executionWaiters.get(key) ?? new Set();
        this.executionWaiters.set(key, waiters);
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          current?.off("event", listener);
          waiters.delete(finish);
          if (waiters.size === 0) this.executionWaiters.delete(key);
          resolve();
        };
        const timer = setTimeout(finish, remaining);
        const listener = (event: AgentEvent) => {
          if (
            event.type === "result" ||
            event.type === "error" ||
            event.type === "exit"
          ) {
            finish();
          }
        };
        waiters.add(finish);
        current?.on("event", listener);
      });
    }
    throw new Error(
      "Timed out waiting for this chat's current work to finish.",
    );
  }

  async acquireExecutionWhenAvailable(
    workspaceId: string,
    chatId: string,
    owner: "interactive" | "schedule" | "channel",
    timeoutMs = 10 * 60_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      try {
        return this.acquireExecution(workspaceId, chatId, owner);
      } catch (error) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw error;
        await this.waitForExecutionAvailability(workspaceId, chatId, remaining);
      }
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
      this.notifyExecutionWaiters(key);
    }
  }

  assertInteractiveChat(workspaceId: string, chatId: string): Promise<void> {
    return Promise.resolve().then(() =>
      this.assertExecutionAvailable(workspaceId, chatId, "interactive"),
    );
  }

  /**
   * Resolve the chat that is actively running for a workspace. Browser tool
   * calls carry a model-supplied conversationId that can be stale or wrong
   * (the model sometimes reuses a remembered channel id); fall back to the
   * live interactive session so host UI opens in the chat the user is actually
   * watching.
   */
  activeChatId(workspaceId: string): string | undefined {
    let fallback: string | undefined;
    for (const session of this.sessions.values()) {
      if (session.config.workspaceId !== workspaceId) continue;
      if (session.isBusy) return session.chatId;
      fallback ??= session.chatId;
    }
    return fallback;
  }

  /** Resolve identity from the live execution, never from model-authored input. */
  activeAgentSession(
    workspaceId: string,
    requestedSessionId?: string,
    requestedSessionIsCredentialBound = false,
  ): ActiveAgentSessionIdentity | undefined {
    const busy = [...this.sessions.values()].filter(
      (session) => session.config.workspaceId === workspaceId && session.isBusy,
    );
    return resolveActiveAgentSession(
      busy.map((session) => ({
        chatId: session.chatId,
        agentId: session.agent.id,
        threadRootId: session.activeThreadRootId,
      })),
      requestedSessionId,
      requestedSessionIsCredentialBound,
    );
  }

  /**
   * Resolve the session that owns an active integration setup for a workspace.
   * The model guesses sessionId/attemptId when calling OAuth/browser tools; the
   * runtime must instead operate on the session that actually started the setup
   * (or, failing that, the busy interactive session).
   */
  activeSetupSessionId(
    workspaceId: string,
    requestedSessionId?: string,
  ): string | undefined {
    for (const session of this.sessions.values()) {
      if (session.config.workspaceId !== workspaceId) continue;
      if (session.isBusy || session.chatId === requestedSessionId) {
        return session.chatId;
      }
    }
    return undefined;
  }

  activeSessionIds(workspaceId: string): string[] {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.config.workspaceId === workspaceId && session.isBusy,
      )
      .map((session) => session.chatId);
  }

  health() {
    return this.store.health();
  }

  reconcileInterruptedSpecialistSessions(cutoff: number) {
    return this.store.reconcileInterruptedSpecialistSessions(cutoff);
  }

  reconcileInterruptedBrowserRuns(cutoff: number) {
    return this.store.reconcileInterruptedBrowserRuns(cutoff);
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

  /** Replace the active channel responder while retaining its shared transcript. */
  async switchRootChatAgent(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
  ): Promise<AgentSession> {
    const stored = await this.store.chatRecord(config.workspaceId, chatId);
    if (!stored) throw new Error("Session was not found in this workspace.");
    this.assertRootChat(stored);

    const key = workspaceChatKey(config.workspaceId, chatId);
    const existing = this.sessions.get(key);
    if (
      existing?.agent.id === agent.id &&
      existing.agent.instructions === agent.instructions &&
      existing.config.driver === config.driver &&
      existing.config.model === config.model
    ) {
      return existing;
    }
    if (existing?.isBusy) {
      throw new Error(
        "Wait for the current agent response before tagging another agent.",
      );
    }
    await (this.persistence.get(key) ?? Promise.resolve());
    if (existing) {
      this.archivedEvents.set(key, existing.events.slice(-500));
      this.sessions.delete(key);
      await existing.stop();
    }
    await this.store.updateChatState(config.workspaceId, chatId, {
      agent: agent.id,
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
    agentId = "chief",
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
    agentId = "chief",
  ) {
    const stored = await this.store.chatRecord(workspaceId, chatId);
    if (!stored) {
      const preference = provider
        ? undefined
        : await this.store.agentPreference(workspaceId, "chief");
      const driver = provider ?? preference?.driver;
      if (!driver) throw new Error("Configure Chief's agent app first.");
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
    if (agent.id === "chief")
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
      if (agent.id === "chief") {
        throw new Error(
          "Chief task sessions must be started atomically by a schedule.",
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
    } else if (agent.id === "chief" && !stored.scheduleId) {
      throw new Error("Chief task sessions must belong to a schedule.");
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

  private startSession(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
  ) {
    return startManagedSession(
      {
        archivedEvents: this.archivedEvents,
        lockWorkspaceIfInactive: (workspaceId) =>
          this.lockWorkspaceIfInactive(workspaceId),
        persistence: this.persistence,
        repairWorkspaceFiles: (workspaceId) =>
          this.repairWorkspaceFiles(workspaceId),
        released: this.released,
        sessionEnvironmentProvider: this.sessionEnvironmentProvider,
        sessions: this.sessions,
        startingWorkspaces: this.startingWorkspaces,
        stopReleased: (workspaceId, chatId) =>
          this.stopReleased(workspaceId, chatId),
        store: this.store,
      },
      agent,
      chatId,
      config,
    );
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
    await this.store.deleteChat(workspaceId, chatId);
    this.sessions.delete(key);
    this.archivedEvents.delete(workspaceChatKey(workspaceId, chatId));
    this.retainCounts.delete(key);
    this.released.delete(key);
    this.executionOwners.delete(key);
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
      root.chat.title !== "Initial business review" &&
      !hasInitialReviewKickoff(root.events)
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

  /** Reset a failed specialist session so a retry can run it fresh. */
  async restartChildChat(workspaceId: string, chatId: string) {
    const inspected = await this.inspectChat(workspaceId, chatId);
    if (
      inspected.chat.kind !== "task" ||
      inspected.chat.visibility !== "private" ||
      !inspected.chat.parentId ||
      inspected.chat.scheduleId
    ) {
      throw new Error("Only delegated specialist sessions can restart here.");
    }
    const key = workspaceChatKey(workspaceId, chatId);
    const existing = this.sessions.get(key);
    if (existing?.isBusy) {
      throw new Error("Wait for the current response before retrying it.");
    }
    await (this.persistence.get(key) ?? Promise.resolve());
    if (existing) {
      this.archivedEvents.set(key, existing.events.slice(-500));
      this.sessions.delete(key);
      await existing.stop();
    }
    await this.store.restartSpecialistSession(workspaceId, chatId);
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
        driver: parseDriverType(inspected.chat.provider),
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

  /**
   * Run a write after the chat transcript queue and make later transcript
   * writes wait for it. Channel mirroring shares Chief's SQLite database with
   * transcript persistence, so merely awaiting the current promise still
   * leaves a race with the next event's write.
   */
  enqueueChatPersistence<T>(
    workspaceId: string,
    chatId: string,
    write: () => Promise<T>,
  ): Promise<T> {
    const key = workspaceChatKey(workspaceId, chatId);
    const queued = (this.persistence.get(key) ?? Promise.resolve()).then(write);
    this.persistence.set(
      key,
      queued.then(
        () => undefined,
        () => undefined,
      ),
    );
    return queued;
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
