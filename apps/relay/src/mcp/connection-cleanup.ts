import { agentConfigSchema, walkAutomation } from "@chief/relay-contracts";

import type { AgentConfigRow } from "../workspace-channel-store";
import { agentConfigsInsertConfigSet } from "../queries/agent-configs/insert-config-set";
import { agentConfigsListAll } from "../queries/agent-configs/list-all";
import {
  readWorkspaceSchedules,
  writeWorkspaceSchedule,
} from "../workspace-schedule-store";

/** A removed plugin leaves nothing a new one with the same id could inherit. */
export function unlinkConnection(
  storage: DurableObjectStorage,
  connectionId: string,
) {
  const updatedAt = new Date().toISOString();
  for (const row of agentConfigsListAll<AgentConfigRow>(storage)) {
    const config = agentConfigSchema.parse(JSON.parse(row.config_json));
    if (!config.integrations.includes(connectionId)) continue;
    agentConfigsInsertConfigSet(storage, {
      agentId: row.agent_id,
      configJson: JSON.stringify({
        ...config,
        integrations: config.integrations.filter((id) => id !== connectionId),
      }),
      updatedAt,
    });
  }
  // Automations that used it need a person to look again; clearing the
  // approval also cancels any run in flight.
  const now = Date.now();
  for (const stored of readWorkspaceSchedules(storage)) {
    const uses = [
      ...walkAutomation(stored.schedule.automation?.steps ?? []),
    ].some(
      ({ step }) =>
        step.type === "tool" &&
        step.tool.source === "plugin" &&
        step.tool.connectionId === connectionId,
    );
    if (!uses) continue;
    writeWorkspaceSchedule(storage, {
      schedule: {
        ...stored.schedule,
        status: "needs_approval",
        nextAt: undefined,
        updatedAt: Math.max(now, stored.schedule.updatedAt + 1),
      },
      approvedBy: null,
    });
  }
}
