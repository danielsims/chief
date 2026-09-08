import { callPluginTool } from "../../relay-cell-plugin-tools.js";
import { agentToolName } from "../../tools/model.js";
import { defineRelayCellTool } from "../tool.js";

function pluginTool(
  operationId: string,
  permission: "workspace.read" | "messages.send",
) {
  return defineRelayCellTool(
    operationId,
    permission,
    async (context, input) =>
      await callPluginTool(agentToolName(operationId), input, context),
  );
}

export const relayCellPluginTools = [
  pluginTool("plugins.list", "workspace.read"),
  pluginTool("plugins.recommend", "messages.send"),
];
