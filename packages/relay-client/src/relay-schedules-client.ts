import type {
  WorkspaceScheduleAction,
  WorkspaceScheduleInput,
} from "@chief/relay-contracts";
import {
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
