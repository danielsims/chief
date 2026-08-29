import { randomUUID } from "node:crypto";

import type { ChatContext, LocalStore } from "./local-store.js";
import type {
  ActionItem,
  AgentEvent,
  AgentPreference,
  AnalyticsDataset,
  CampaignRecord,
  ContentDraftRecord,
  ProspectRecord,
  RecurringWorkRecord,
  ScheduleSessionActionTransition,
  SessionRecord,
  TrendRecord,
  WorkspaceFileSnapshot,
  WorkspaceFileWrite,
} from "./types.js";
import { workspaceData } from "./workspace-data.js";
import {
  assertWorkspaceTextContent,
  defaultWorkspaceFilePath,
  normalizeWorkspaceFilePath,
  removeWorkspaceFileContent,
  repairWorkspaceFileContent,
  stageWorkspaceFileContent,
} from "./workspace-files.js";

/** Durable workspace and store operations shared by the session manager. */
export abstract class ManagerWorkspaceStore {
  private readonly repairedFileWorkspaces = new Set<string>();

  protected constructor(readonly store: LocalStore) {}

  workspaceData(workspaceId: string) {
    return workspaceData(this.store, workspaceId);
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
      if (file)
        repairWorkspaceFileContent(
          workspaceId,
          file.path,
          file.currentVersionId,
          file.content,
        );
      return file;
    });
  }

  protected async repairWorkspaceFiles(workspaceId: string) {
    if (this.repairedFileWorkspaces.has(workspaceId)) return;
    for (const record of await this.store.listWorkspaceFiles(workspaceId)) {
      const file = await this.store.workspaceFile(workspaceId, record.id);
      if (file)
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
    )
      throw new Error("FILE_VERSION_CONFLICT");
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
  recurringWorkByOperationKey(workspaceId: string, operationKey: string) {
    return this.store.recurringWorkByOperationKey(workspaceId, operationKey);
  }
  recurringWorkWorkspaceId(id: string) {
    return this.store.recurringWorkWorkspaceId(id);
  }
  scheduleRuns(workspaceId: string, scheduleId: string) {
    return this.store.scheduleRuns(workspaceId, scheduleId);
  }
  scheduleRun(workspaceId: string, scheduleId: string, runId: string) {
    return this.store.scheduleRun(workspaceId, scheduleId, runId);
  }
  scheduleWebhookSecretHash(workspaceId: string, scheduleId: string) {
    return this.store.scheduleWebhookSecretHash(workspaceId, scheduleId);
  }
  setScheduleWebhookSecretHash(
    workspaceId: string,
    scheduleId: string,
    hash: string | undefined,
  ) {
    return this.store.setScheduleWebhookSecretHash(
      workspaceId,
      scheduleId,
      hash,
    );
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
}
