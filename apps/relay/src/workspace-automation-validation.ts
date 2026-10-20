import type { WorkspaceScheduleInput } from "@chief/relay-contracts";
import { automationAgents, automationToolRefs } from "@chief/relay-contracts";

import { automationChiefTool } from "./automation-tools";
import { HttpError } from "./http";
import { McpConnectionService } from "./mcp/connection-service";
import { WorkspaceChannelStore } from "./workspace-channel-store";

/**
 * What saving an automation needs beyond its shape. Every agent step belongs
 * to the schedule's team, so the run's channel and liveness checks cover it.
 * Every tool exists now, and a plugin tool is pinned as a read only when the
 * plugin itself says so.
 */
export function validateAutomationForSave(
  storage: DurableObjectStorage,
  env: Env,
  workspaceId: string,
  input: WorkspaceScheduleInput,
) {
  const automation = input.automation;
  if (!automation) return;
  const team = new Set<string>([input.agentId, ...input.collaborators]);
  for (const agentId of automationAgents(automation))
    if (!team.has(agentId))
      throw new HttpError(
        400,
        "automation_agent_outside_team",
        `Add ${agentId} to this automation's team before giving it a step.`,
      );
  const plugins = new McpConnectionService(storage, env, workspaceId);
  const assigned = new WorkspaceChannelStore(storage, env).agentConfiguration(
    input.agentId,
  ).integrations;
  for (const tool of automationToolRefs(automation)) {
    if (tool.source === "chief") {
      if (!automationChiefTool(tool.name))
        throw new HttpError(
          400,
          "automation_tool_unknown",
          `${tool.name} can't run in an automation.`,
        );
      continue;
    }
    const connection = plugins
      .list()
      .find((item) => item.id === tool.connectionId);
    const current = connection?.tools.find((item) => item.name === tool.name);
    // The lead agent owns the automation, so it must be trusted with each
    // plugin the steps use, as it would be to use them itself.
    if (connection && !assigned.includes(connection.id))
      throw new HttpError(
        400,
        "automation_plugin_unassigned",
        `Give ${input.agentId} access to ${connection.name} in Agents before using it in this automation.`,
      );
    if (!connection || !current)
      throw new HttpError(
        400,
        "automation_plugin_tool_missing",
        `${tool.name} isn't available from a connected plugin.`,
      );
    if (current.readOnly !== tool.readOnly)
      throw new HttpError(
        409,
        "automation_plugin_tool_changed",
        `${connection.name} changed whether ${tool.name} can change data. Re-add the step to review it.`,
      );
  }
}
