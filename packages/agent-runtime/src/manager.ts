import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { ChatContext, LocalChatRecord } from "./local-store.js";
import type { SessionConfig } from "./session.js";
import type {
  AgentDefinition,
  AgentEvent,
  AgentPreference,
  AttentionItem,
  CampaignRecord,
  ContentDraftRecord,
  DriverType,
  ProspectRecord,
  RecurringWorkRecord,
  RecurringWorkRunRecord,
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
  private executionOwners = new Map<
    string,
    { id: string; owner: "interactive" | "schedule" | "channel" }
  >();
  /** Workspaces with a session mid-open, so their secrets must not lock. */
  private startingWorkspaces = new Map<string, number>();
  private readonly repairedFileWorkspaces = new Set<string>();

  constructor(private readonly store = new LocalStore()) {}

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

  async assertInteractiveChat(workspaceId: string, chatId: string) {
    if (await this.store.recurringWorkByChat(workspaceId, chatId)) {
      throw new Error(
        "Schedule chats are read-only here. Open the run from Results or Schedule.",
      );
    }
    this.assertExecutionAvailable(workspaceId, chatId, "interactive");
  }

  health() {
    return this.store.health();
  }

  async ensureRootChat(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
    title = "",
  ): Promise<AgentSession> {
    if (agent.id !== "cmo") throw new Error("Root chats are owned by CMO.");
    await this.createRootChat(
      config.workspaceId,
      chatId,
      title,
      config.driver,
      config.model,
    );
    return this.ensureSession(agent, chatId, config);
  }

  async createRootChat(
    workspaceId: string,
    chatId: string,
    title: string,
    provider?: DriverType,
    model?: string,
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
        workspaceId,
        visibility: "user",
        agent: "cmo",
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
    config: Omit<SessionConfig, "mcpServers" | "automationGrant">,
  ): Promise<AgentSession> {
    if (agent.id === "cmo")
      throw new Error("Child chats require a specialist.");
    await this.rootChat(config.workspaceId, parentId);
    const stored = await this.store.chatRecord(config.workspaceId, chatId);
    if (!stored) {
      await this.store.createChat({
        id: chatId,
        workspaceId: config.workspaceId,
        parentId,
        visibility: "private",
        agent: agent.id,
        provider: config.driver,
        model: config.model,
      });
    } else if (
      stored.visibility !== "private" ||
      stored.parentId !== parentId ||
      stored.agent !== agent.id
    ) {
      throw new Error("Child chat identity does not match stored state.");
    }
    return this.ensureSession(agent, chatId, {
      ...config,
      mcpServers: [],
      automationGrant: undefined,
    });
  }

  private async ensureSession(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
  ): Promise<AgentSession> {
    await this.repairWorkspaceFiles(config.workspaceId);
    const key = workspaceChatKey(config.workspaceId, chatId);
    const existing = this.sessions.get(key);
    if (existing) {
      // A live session can't hop backends or change its access level.
      if (
        existing.config.driver !== config.driver ||
        existing.config.access !== config.access ||
        existing.config.workspaceId !== config.workspaceId ||
        existing.config.model !== config.model ||
        existing.agent.instructions !== agent.instructions ||
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

    // Mark the workspace as starting before any await so a concurrently
    // closing session can't lock (delete) its secrets mid-materialize.
    this.startingWorkspaces.set(
      config.workspaceId,
      (this.startingWorkspaces.get(config.workspaceId) ?? 0) + 1,
    );
    let env: Record<string, string>;
    try {
      env = await workspaceSecrets.materialize(config.workspaceId);
    } finally {
      const remaining =
        (this.startingWorkspaces.get(config.workspaceId) ?? 1) - 1;
      if (remaining > 0) {
        this.startingWorkspaces.set(config.workspaceId, remaining);
      } else {
        this.startingWorkspaces.delete(config.workspaceId);
      }
    }
    const scopedConfig = { ...config, env };
    const archivedKey = workspaceChatKey(config.workspaceId, chatId);
    const storedEvents =
      this.archivedEvents.get(archivedKey) ??
      (await this.store.transcript(config.workspaceId, chatId));
    const storedChat = await this.store.chatRecord(config.workspaceId, chatId);
    const session = new AgentSession(agent, chatId, scopedConfig, storedEvents);
    this.sessions.set(key, session);

    session.on("event", (event: AgentEvent) => {
      if (event.type === "init") {
        const persistence = (this.persistence.get(key) ?? Promise.resolve())
          .then(() =>
            this.store.updateChatState(config.workspaceId, chatId, {
              providerState: { sessionId: event.sessionId },
            }),
          )
          .then(() => undefined)
          .catch((error) => console.error("[local-store] state:", error));
        this.persistence.set(key, persistence);
      }
      if (event.type === "status") {
        const persistence = (this.persistence.get(key) ?? Promise.resolve())
          .then(() =>
            this.store.updateChatState(config.workspaceId, chatId, {
              status: event.status,
            }),
          )
          .then(() => undefined)
          .catch((error) => console.error("[local-store] status:", error));
        this.persistence.set(key, persistence);
      }
      if (event.type === "exit") {
        this.archivedEvents.set(archivedKey, session.events.slice(-500));
        if (this.sessions.get(key) === session) {
          this.sessions.delete(key);
        }
        this.lockWorkspaceIfInactive(config.workspaceId);
      }
      if (
        event.type === "message" ||
        event.type === "result" ||
        event.type === "error" ||
        event.type === "permissionResolved"
      ) {
        const persistence = (this.persistence.get(key) ?? Promise.resolve())
          .then(() =>
            this.store.saveTranscript(
              {
                id: chatId,
                workspaceId: config.workspaceId,
                agentId: agent.id,
                driver: config.driver,
                model: config.model,
                providerState: session.sessionId
                  ? { sessionId: session.sessionId }
                  : undefined,
              },
              session.events,
            ),
          )
          .catch((error) => console.error("[local-store] transcript:", error));
        this.persistence.set(key, persistence);
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

    const cwd = join(workspaceRoot(config.workspaceId), "agents", agent.id);
    mkdirSync(cwd, { recursive: true });
    const continuation =
      storedChat?.provider === config.driver &&
      storedChat.providerState &&
      typeof storedChat.providerState === "object" &&
      "sessionId" in storedChat.providerState &&
      typeof storedChat.providerState.sessionId === "string"
        ? storedChat.providerState.sessionId
        : undefined;
    try {
      await session.start(cwd, continuation);
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

  listChats(workspaceId: string) {
    return this.store.listChats(workspaceId);
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

  childChats(workspaceId: string, rootChatId: string) {
    return this.rootChat(workspaceId, rootChatId).then(() =>
      this.store.listChildChats(workspaceId, rootChatId),
    );
  }

  private assertRootChat(chat: LocalChatRecord) {
    if (chat.parentId || chat.visibility !== "user" || chat.agent !== "cmo") {
      throw new Error("Only a top-level user-visible CMO chat is composable.");
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
      drafts,
      campaigns,
      recurringWork,
      recurringWorkRuns,
    ] = await Promise.all([
      this.store.listProspects(workspaceId),
      this.store.listTrends(workspaceId),
      this.store.listDrafts(workspaceId),
      this.store.listCampaigns(workspaceId),
      this.store.listRecurringWork(workspaceId),
      this.store.listRecurringWorkRuns(workspaceId),
    ]);
    // Content records predate editable workspace files. Upgrade them lazily so
    // existing drafts become reviewable without a destructive database
    // migration or a second content model.
    const reviewableDrafts: typeof drafts = [];
    const filesByPath = new Map(
      (await this.store.listWorkspaceFiles(workspaceId)).map((file) => [
        file.path,
        file,
      ]),
    );
    for (const draft of drafts) {
      if (draft.fileId) {
        reviewableDrafts.push(draft);
        continue;
      }
      // libSQL uses one local writer. Keep this compatibility migration
      // ordered so several legacy drafts cannot race file-version
      // transactions on first launch.
      const path = `content/${draft.id}.md`;
      const previouslyCreated = filesByPath.get(path);
      const file = previouslyCreated
        ? await this.store.workspaceFile(workspaceId, previouslyCreated.id)
        : await this.saveWorkspaceFile(workspaceId, {
            name: draft.title,
            path,
            content: draft.body,
            kind: "document",
            createdBy: "agent",
            sourceAgentId: draft.agentId,
          });
      if (!file) throw new Error("The draft document could not be loaded.");
      filesByPath.set(path, file);
      const reviewable = {
        ...draft,
        fileId: file.id,
        updatedAt: Date.now(),
      };
      await this.store.saveDraft(workspaceId, reviewable);
      reviewableDrafts.push(reviewable);
    }
    const attentionItems = await this.store.listAttentionItems(workspaceId);
    return {
      prospects,
      trends,
      drafts: reviewableDrafts,
      campaigns,
      attentionItems,
      recurringWork: recurringWork.map((work) => {
        try {
          const skipped = new Set(work.skipDates ?? []);
          return {
            ...work,
            upcomingRuns:
              work.runOnceAt !== undefined
                ? work.lastRunAt
                  ? []
                  : [work.runOnceAt]
                : upcomingRuns(work.cron, work.timezone).filter(
                    (timestamp) =>
                      !skipped.has(runDateKey(timestamp, work.timezone)),
                  ),
          };
        } catch {
          return { ...work, upcomingRuns: [] };
        }
      }),
      recurringWorkRuns,
    };
  }

  saveProspect(workspaceId: string, prospect: ProspectRecord) {
    return this.store.saveProspect(workspaceId, prospect);
  }

  saveTrend(workspaceId: string, trend: TrendRecord) {
    return this.store.saveTrend(workspaceId, trend);
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
      sourceRunId: input.sourceRunId ?? existing?.sourceRunId,
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

  raiseAttentionItem(workspaceId: string, item: AttentionItem) {
    return this.store.raiseAttentionItem(workspaceId, item);
  }

  dismissAttentionItem(workspaceId: string, id: string) {
    return this.store.dismissAttentionItem(workspaceId, id);
  }

  latestRunBlockedTools(workspaceId: string, recurringWorkId: string) {
    return this.store.latestRunBlockedTools(workspaceId, recurringWorkId);
  }

  deleteRecurringWorkRun(workspaceId: string, runId: string) {
    return this.store.deleteRecurringWorkRun(workspaceId, runId);
  }

  async deleteRecurringWork(workspaceId: string, id: string) {
    const work = await this.store.recurringWorkById(workspaceId, id);
    if (work) await this.stopRuntimeChat(workspaceId, work.chatId);
    await this.store.deleteRecurringWork(workspaceId, id);
    if (work) await this.store.deleteChat(workspaceId, work.chatId);
  }

  claimRecurringWork(
    workspaceId: string,
    id: string,
    expectedNextRunAt: number,
    nextRunAt: number | null,
  ) {
    return this.store.claimRecurringWork(
      workspaceId,
      id,
      expectedNextRunAt,
      nextRunAt,
    );
  }

  saveRecurringWorkRun(workspaceId: string, run: RecurringWorkRunRecord) {
    return this.store.saveRecurringWorkRun(workspaceId, run);
  }

  startRecurringWorkRun(
    workspaceId: string,
    run: RecurringWorkRunRecord,
    transition?: { expectedNextRunAt?: number; nextRunAt: number | null },
  ) {
    return this.store.startRecurringWorkRun(workspaceId, run, transition);
  }

  finishRecurringWorkRun(
    workspaceId: string,
    run: RecurringWorkRunRecord,
    work: RecurringWorkRecord,
  ) {
    return this.store.finishRecurringWorkRun(workspaceId, run, work);
  }

  reconcileInterruptedRecurringWorkRuns(cutoff: number) {
    return this.store.reconcileInterruptedRecurringWorkRuns(cutoff);
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
