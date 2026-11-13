import { agentConfigSchema } from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { agentConfigsUpdateEnableHostedSpecialists } from "./queries/agent-configs/update-enable-hosted-specialists";

const GATEWAY_SECRET = "vercel-ai-gateway";

/**
 * Chief on Vercel Eve runs in the cloud, so its teammates do too: each one is
 * enabled on Chief Cloud with the workspace's gateway credential.
 */
export function enableHostedSpecialists(
  storage: DurableObjectStorage,
  channels: WorkspaceChannelStore,
  chiefId: string,
  now: string,
) {
  for (const agentId of channels.workspaceAgentIds()) {
    if (agentId === chiefId) continue;
    const config = channels.agentConfiguration(agentId);
    const inference =
      config.inference.provider === "vercel-ai-gateway" ||
      config.inference.provider === "opencode"
        ? { ...config.inference, secretRef: GATEWAY_SECRET }
        : config.inference;
    agentConfigsUpdateEnableHostedSpecialists(storage, {
      agentId,
      configJson: JSON.stringify(
        agentConfigSchema.parse({
          ...config,
          enabled: true,
          deploymentTarget: "cloud",
          inference,
        }),
      ),
      updatedAt: now,
    });
  }
}
