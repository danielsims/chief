import { invoke, isTauri } from "@tauri-apps/api/core";

import type { RelayClient } from "@chief/relay-client";
import type { AgentConfig, WorkspaceSnapshot } from "@chief/relay-contracts";

import { RELAY_URL } from "./config";
import { shouldStartDesktopCells } from "./desktop-cell-runtime-selection";

export { shouldStartDesktopCells } from "./desktop-cell-runtime-selection";

export async function ensureDesktopCells(
  snapshot: WorkspaceSnapshot,
  workspace: RelayClient,
  configuredAgents?: readonly { agentId: string; config: AgentConfig }[],
) {
  // Workspaces created before runtime selection was persisted have `null`.
  // They were desktop workspaces, so keep their agents runnable after upgrade.
  if (!isTauri() || !shouldStartDesktopCells(snapshot.runtime)) return;
  const agents =
    configuredAgents ??
    (await Promise.all(
      snapshot.agents.map(async (agent) => {
        const [configuration, pubkey] = await Promise.all([
          workspace.loadAgentConfig(agent.id),
          invoke<string>("relay_agent_public_key", {
            relayUrl: RELAY_URL,
            workspaceId: snapshot.id,
            agentId: agent.id,
          }),
        ]);
        await workspace.registerAgentKey(agent.id, pubkey);
        return { agentId: agent.id, config: configuration.config };
      }),
    ));
  await invoke("start_workspace_cells", {
    relayUrl: RELAY_URL,
    workspaceId: snapshot.id,
    agents,
  });
}
