import { optionalString, requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

/** The same build loop the automations agent uses: find, test, read back. */
export const relayCellAutomationBuildTools = [
  defineRelayCellTool(
    "automations.tools",
    "workspace.read",
    async ({ client }, input) => {
      const query = optionalString(input, "query");
      const agentId = optionalString(input, "agentId");
      return await client.schedules.build("tools", {
        ...(query ? { query } : undefined),
        ...(agentId ? { agentId } : undefined),
      });
    },
  ),
  defineRelayCellTool(
    "automations.inspect",
    "workspace.read",
    async ({ client }, input) =>
      await client.schedules.build("inspect", {
        id: requiredString(input, "id"),
      }),
  ),
  defineRelayCellTool(
    "automations.test",
    "workspace.write",
    async ({ client }, input) =>
      await client.schedules.build("test", {
        id: requiredString(input, "id"),
      }),
  ),
];
