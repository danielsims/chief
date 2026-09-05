import { invoke, isTauri } from "@tauri-apps/api/core";

import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";

import { watchCodexSetup } from "./codex-setup-progress";
import { RELAY_URL } from "./config";
import { isDesktopNativeCell } from "./desktop-cell-runtime-selection";

export { isDesktopNativeCell } from "./desktop-cell-runtime-selection";

export async function ensureDesktopCells(
  snapshot: WorkspaceSnapshot,
  workspace: Pick<RelayClient, "loadAgentConfig" | "registerAgentKey">,
) {
  if (!isTauri()) return;
  const configurations = await Promise.all(
    snapshot.agents
      .filter((agent) => agent.runtime.kind === "native-cell")
      .map(async (agent) => {
        const configuration = await workspace.loadAgentConfig(agent.id);
        return { agentId: agent.id, config: configuration.config };
      }),
  );
  const agents = await Promise.all(
    configurations
      .filter(({ config }) => isDesktopNativeCell(config))
      .map(async ({ agentId, config }) => {
        const pubkey = await invoke<string>("relay_agent_public_key", {
          relayUrl: RELAY_URL,
          workspaceId: snapshot.id,
          agentId,
        });
        await workspace.registerAgentKey(agentId, pubkey);
        return { agentId, config };
      }),
  );
  await invoke("start_workspace_cells", {
    relayUrl: RELAY_URL,
    workspaceId: snapshot.id,
    agents,
  });
  for (const { agentId, config } of agents) {
    if (config.inference.provider === "codex")
      watchCodexSetup(RELAY_URL, snapshot.id, agentId);
  }
}
