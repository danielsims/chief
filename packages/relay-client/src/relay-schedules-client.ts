import type {
  AutomationBuildRequest,
  AutomationWebhookRequest,
  WorkspaceScheduleAction,
  WorkspaceScheduleInput,
} from "@chief/relay-contracts";
import {
  automationBuildRequestSchema,
  automationBuildResultSchema,
  automationWebhookEventListSchema,
  automationWebhookListSchema,
  automationWebhookRequestSchema,
  automationWebhookRevokedSchema,
  automationWebhookSchema,
  scheduleRunCollaboratorSchema,
  scheduleRunListSchema,
  scheduleRunReportSchema,
  scheduleRunSchema,
  workspaceScheduleActionSchema,
  workspaceScheduleDeleteResultSchema,
  workspaceScheduleInputSchema,
  workspaceScheduleSchema,
  workspaceSchedulesResultSchema,
} from "@chief/relay-contracts";

import type { RelayClientOptions } from "./relay-client-options";
import { RelayClientBase } from "./relay-client-base";

export class RelaySchedulesClient extends RelayClientBase {
  constructor(options: RelayClientOptions) {
    super(options);
  }

  async runs(scheduleId: string) {
    return (
      await this.fetchJson(
        this.workspaceUrl(`schedules/${encodeURIComponent(scheduleId)}/runs`),
        scheduleRunListSchema,
      )
    ).runs;
  }
  runAction(
    scheduleId: string,
    runId: string,
    action: "cancel" | "retry",
    commandId = crypto.randomUUID(),
  ) {
    return this.fetchJson(
      this.workspaceUrl(
        `schedules/${encodeURIComponent(scheduleId)}/runs/${encodeURIComponent(runId)}/actions`,
      ),
      scheduleRunSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, commandId }),
      },
    );
  }
  reportStep(input: {
    runId: string;
    stepId: string;
    status: "completed" | "blocked";
    evidence: string;
  }) {
    return this.fetchJson(
      this.workspaceUrl("schedule-runs/report"),
      scheduleRunSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scheduleRunReportSchema.parse(input)),
      },
    );
  }
  addCollaborator(input: {
    runId: string;
    agentId: string;
    assignment: string;
  }) {
    return this.fetchJson(
      this.workspaceUrl("schedule-runs/collaborators"),
      scheduleRunSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scheduleRunCollaboratorSchema.parse(input)),
      },
    );
  }
  /** Every automation URL the caller can manage. */
  async webhooks() {
    return (
      await this.fetchJson(
        this.workspaceUrl("webhooks"),
        automationWebhookListSchema,
      )
    ).webhooks;
  }

  /** The latest events sent to the automation's URL, newest first. */
  async webhookEvents(scheduleId: string) {
    return (
      await this.fetchJson(
        this.workspaceUrl(
          `schedules/${encodeURIComponent(scheduleId)}/webhook/events`,
        ),
        automationWebhookEventListSchema,
      )
    ).events;
  }

  /** Deletes the automation's URL. Opening its trigger issues a new one. */
  async revokeWebhook(scheduleId: string) {
    await this.fetchJson(
      this.workspaceUrl(`schedules/${encodeURIComponent(scheduleId)}/webhook`),
      automationWebhookRevokedSchema,
      true,
      { method: "DELETE" },
    );
  }

  /**
   * The automation's inbound URL, issued on first request, even for a draft.
   * The same call resets the URL or sets and removes its signing secret,
   * which is write-only and never comes back.
   */
  webhook(
    scheduleId: string,
    request: AutomationWebhookRequest = { action: "get" },
  ) {
    return this.fetchJson(
      this.workspaceUrl(`schedules/${encodeURIComponent(scheduleId)}/webhook`),
      automationWebhookSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(automationWebhookRequestSchema.parse(request)),
      },
    );
  }

  async list(range?: { from: number; to: number }) {
    const url = new URL(this.workspaceUrl("schedules"));
    if (range) {
      url.searchParams.set("from", String(range.from));
      url.searchParams.set("to", String(range.to));
    }
    return (
      await this.fetchJson(url.toString(), workspaceSchedulesResultSchema)
    ).schedules;
  }

  save(input: WorkspaceScheduleInput) {
    return this.fetchJson(
      this.workspaceUrl("schedules"),
      workspaceScheduleSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(workspaceScheduleInputSchema.parse(input)),
      },
    );
  }

  act(
    id: string,
    action: WorkspaceScheduleAction,
    options: { commandId?: string; expectedUpdatedAt?: number } = {},
  ) {
    return this.fetchJson(
      this.workspaceUrl(`schedules/${encodeURIComponent(id)}/actions`),
      workspaceScheduleSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          workspaceScheduleActionSchema.parse({
            action,
            commandId: options.commandId ?? crypto.randomUUID(),
            expectedUpdatedAt: options.expectedUpdatedAt,
          }),
        ),
      },
    );
  }

  /** Asks Chief to build or change an automation from a request. */
  build(id: string, input: AutomationBuildRequest) {
    return this.fetchJson(
      this.workspaceUrl(`schedules/${encodeURIComponent(id)}/build`),
      automationBuildResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(automationBuildRequestSchema.parse(input)),
        // Building waits on the model, up to twice, so it outlasts the
        // default request bound.
        signal: AbortSignal.timeout(180_000),
      },
    );
  }

  delete(id: string) {
    return this.fetchJson(
      this.workspaceUrl(`schedules/${encodeURIComponent(id)}`),
      workspaceScheduleDeleteResultSchema,
      true,
      { method: "DELETE" },
    );
  }
}
