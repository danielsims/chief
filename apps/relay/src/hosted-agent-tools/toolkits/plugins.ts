import { executeHostedAgentPluginTool } from "../../hosted-agent-plugin-tools";
import { defineHostedAgentTool } from "../tool";

function pluginTool(operationId: "plugins.list" | "plugins.recommend") {
  return defineHostedAgentTool(
    operationId,
    async ({ env, job }, input) =>
      await executeHostedAgentPluginTool(env, job, operationId, input),
  );
}

export const hostedPluginTools = [
  pluginTool("plugins.list"),
  pluginTool("plugins.recommend"),
];
