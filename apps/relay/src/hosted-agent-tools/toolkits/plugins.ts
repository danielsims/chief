import { executeHostedAgentPluginTool } from "../../hosted-agent-plugin-tools";
import { defineHostedAgentTool } from "../tool";

function pluginTool(
  operationId: "plugins.list" | "plugins.recommend",
  effect: "read_only" | "idempotent",
) {
  return defineHostedAgentTool(
    operationId,
    async ({ env, job }, input) =>
      await executeHostedAgentPluginTool(env, job, operationId, input),
    { effect },
  );
}

export const hostedPluginTools = [
  pluginTool("plugins.list", "read_only"),
  pluginTool("plugins.recommend", "idempotent"),
];
