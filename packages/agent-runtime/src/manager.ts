import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { SessionConfig } from "./session.js";
import type {
  AgentDefinition,
  AgentEvent,
  RecurringWorkRunRecord,
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

const CURRENT_HOME = join(homedir(), ".chief");
const LEGACY_HOME = join(homedir(), ".marketer");
const HOME =
  !existsSync(join(CURRENT_HOME, "sessions.json")) &&
  existsSync(join(LEGACY_HOME, "sessions.json"))
    ? LEGACY_HOME
    : CURRENT_HOME;

function workspaceChatKey(workspaceId: string, chatId: string) {
  return `${workspaceId}\0${chatId}`;
}

interface PersistedSession {
  agentId: string;
  sessionId: string;
  driver?: string;
  workspaceId?: string;
}

/**
 * One live session per chatId. Backend-native session ids are persisted to
 * ~/.chief/sessions.json so chats resume across service restarts — the
 * CLI's own transcripts remain the source of truth for history.
 */
export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private archivedEvents = new Map<string, AgentEvent[]>();
  private retainCounts = new Map<string, number>();
  private released = new Set<string>();
  private persistence = new Map<string, Promise<void>>();
  /** Workspaces with a session mid-open, so their secrets must not lock. */
  private startingWorkspaces = new Map<string, number>();
  private persisted: Record<string, PersistedSession> = {};
  private readonly store = new LocalStore();
  private readonly repairedFileWorkspaces = new Set<string>();

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

  health() {
    return this.store.health();
  }

  async ensure(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
  ): Promise<AgentSession> {
    await this.repairWorkspaceFiles(config.workspaceId);
    const existing = this.sessions.get(chatId);
    if (existing) {
      // A live session can't hop backends or change its access level.
      if (
        existing.config.driver !== config.driver ||
        existing.config.access !== config.access ||
        existing.config.workspaceId !== config.workspaceId ||
        existing.config.model !== config.model ||
        existing.agent.instructions !== agent.instructions ||
        JSON.stringify(existing.config.mcpServers ?? []) !==
          JSON.stringify(config.mcpServers ?? [])
      ) {
        await existing.stop();
        this.sessions.delete(chatId);
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
    const session = new AgentSession(agent, chatId, scopedConfig, storedEvents);
    this.sessions.set(chatId, session);

    session.on("event", (event) => {
      if (event.type === "init") {
        this.persisted[chatId] = {
          agentId: agent.id,
          sessionId: event.sessionId,
          driver: config.driver,
          workspaceId: config.workspaceId,
        };
        this.save();
      }
      if (event.type === "exit") {
        this.archivedEvents.set(archivedKey, session.events.slice(-500));
        if (this.sessions.get(chatId) === session) {
          this.sessions.delete(chatId);
        }
        this.lockWorkspaceIfInactive(config.workspaceId);
      }
      if (
        event.type === "message" ||
        event.type === "result" ||
        event.type === "error" ||
        event.type === "permissionResolved"
      ) {
        const persistence = (this.persistence.get(chatId) ?? Promise.resolve())
          .then(() =>
            this.store.saveTranscript(
              {
                id: chatId,
                workspaceId: config.workspaceId,
                agentId: agent.id,
                driver: config.driver,
                model: config.model,
              },
              session.events,
            ),
          )
          .catch((error) => console.error("[local-store] transcript:", error));
        this.persistence.set(chatId, persistence);
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

    const cwd = join(workspaceRoot(config.workspaceId), "agents", agent.id);
    mkdirSync(cwd, { recursive: true });
    // Session ids don't transfer across backends — only resume same-driver.
    const prev = this.persisted[chatId];
    const resume =
      prev &&
      prev.driver === config.driver &&
      prev.workspaceId === config.workspaceId
        ? prev.sessionId
        : undefined;
    try {
      await session.start(cwd, resume);
    } catch (error) {
      if (this.sessions.get(chatId) === session) {
        this.sessions.delete(chatId);
      }
      await session.stop().catch(() => undefined);
      this.lockWorkspaceIfInactive(config.workspaceId);
      throw error;
    }
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
    this.archivedEvents.set(
      workspaceChatKey(session.config.workspaceId, chatId),
      session.events.slice(-500),
    );
    this.sessions.delete(chatId);
    this.released.delete(chatId);
    await session.stop();
    this.lockWorkspaceIfInactive(session.config.workspaceId);
  }

  async remove(workspaceId: string, chatId: string) {
    const session = this.sessions.get(chatId);
    if (session && session.config.workspaceId !== workspaceId) {
      throw new Error("Chat belongs to a different workspace.");
    }
    this.sessions.delete(chatId);
    this.archivedEvents.delete(workspaceChatKey(workspaceId, chatId));
    this.retainCounts.delete(chatId);
    this.released.delete(chatId);
    delete this.persisted[chatId];
    await this.store.deleteChat(workspaceId, chatId);
    this.save();
    await session?.stop();
    if (session) this.lockWorkspaceIfInactive(session.config.workspaceId);
  }

  listChats(workspaceId: string) {
    return this.store.listChats(workspaceId);
  }

  chat(workspaceId: string, chatId: string) {
    return this.store.chat(workspaceId, chatId);
  }

  waitForChatPersistence(chatId: string) {
    return this.persistence.get(chatId) ?? Promise.resolve();
  }

  updateChatPreferences(
    workspaceId: string,
    chatId: string,
    driver: import("./types.js").DriverType,
    model?: string,
  ) {
    return this.store.updateChatPreferences(workspaceId, chatId, driver, model);
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

  saveProspect(
    workspaceId: string,
    prospect: import("./types.js").ProspectRecord,
  ) {
    return this.store.saveProspect(workspaceId, prospect);
  }

  saveTrend(workspaceId: string, trend: import("./types.js").TrendRecord) {
    return this.store.saveTrend(workspaceId, trend);
  }

  saveDraft(
    workspaceId: string,
    draft: import("./types.js").ContentDraftRecord,
  ) {
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

  async saveWorkspaceFile(
    workspaceId: string,
    input: import("./types.js").WorkspaceFileWrite,
  ) {
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
    const file: import("./types.js").WorkspaceFileSnapshot = {
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

  saveCampaign(
    workspaceId: string,
    campaign: import("./types.js").CampaignRecord,
  ) {
    return this.store.saveCampaign(workspaceId, campaign);
  }

  recurringWorkById(workspaceId: string, id: string) {
    return this.store.recurringWorkById(workspaceId, id);
  }

  saveRecurringWork(
    workspaceId: string,
    work: import("./types.js").RecurringWorkRecord,
  ) {
    return this.store.saveRecurringWork(workspaceId, work);
  }

  dueRecurringWork(now: number) {
    return this.store.dueRecurringWork(now);
  }

  saveTranscript(
    context: {
      id: string;
      workspaceId: string;
      agentId: string;
      driver: import("./types.js").DriverType;
      model?: string;
    },
    events: AgentEvent[],
    titleOverride?: string,
  ) {
    return this.store.saveTranscript(context, events, titleOverride);
  }

  transcript(workspaceId: string, chatId: string) {
    return this.store.transcript(workspaceId, chatId);
  }

  raiseAttentionItem(
    workspaceId: string,
    item: import("./types.js").AttentionItem,
  ) {
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

  deleteRecurringWork(workspaceId: string, id: string) {
    return this.store.deleteRecurringWork(workspaceId, id);
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
    work: import("./types.js").RecurringWorkRecord,
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

  saveAgentPreference(
    workspaceId: string,
    preference: import("./types.js").AgentPreference,
  ) {
    return this.store.saveAgentPreference(workspaceId, preference);
  }

  async stopAll() {
    await this.stopSessions();
    await Promise.all(this.persistence.values());
    this.sessions.clear();
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

  private save() {
    writeFileSync(
      join(HOME, "sessions.json"),
      JSON.stringify(this.persisted, null, 2),
    );
  }
}
