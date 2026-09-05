import type {
  WorkspaceScheduleAction,
  WorkspaceScheduleInput,
} from "@chief/relay-contracts";
import {
  scheduleRunListSchema,
  scheduleRunReportSchema,
  scheduleRunSchema,
  scheduleWebhookListSchema,
  scheduleWebhookSecretSchema,
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
  async webhooks() {
    return (
      await this.fetchJson(
        this.workspaceUrl("webhooks"),
        scheduleWebhookListSchema,
      )
    ).webhooks;
  }
  createWebhook(input: { name: string; scheduleId: string }) {
    return this.fetchJson(
      this.workspaceUrl("webhooks"),
      scheduleWebhookSecretSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }
  webhookAction(
    id: string,
    action: "enable" | "disable" | "rotate" | "delete",
  ) {
    return this.fetchJson(
      this.workspaceUrl(`webhooks/${encodeURIComponent(id)}/actions`),
      scheduleWebhookSecretSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
  }

  async list() {
    return (
      await this.fetchJson(
        this.workspaceUrl("schedules"),
        workspaceSchedulesResultSchema,
      )
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

  delete(id: string) {
    return this.fetchJson(
      this.workspaceUrl(`schedules/${encodeURIComponent(id)}`),
      workspaceScheduleDeleteResultSchema,
      true,
      { method: "DELETE" },
    );
  }
}
