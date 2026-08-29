import type {
  AgentPluginSummary,
  PluginAuthorizationAction,
} from "@chief/agent-runtime/types";

interface ConnectablePlugin {
  id: string;
  status: string;
}

interface PluginConnectionRuntime {
  install(pluginId: string): Promise<AgentPluginSummary | undefined>;
  authorize(pluginId: string): Promise<PluginAuthorizationAction | undefined>;
}

export async function connectRecommendedPlugin(
  plugin: ConnectablePlugin,
  runtime: PluginConnectionRuntime,
) {
  if (plugin.status === "available" || plugin.status === "error") {
    await runtime.install(plugin.id);
  }
  return await runtime.authorize(plugin.id);
}
