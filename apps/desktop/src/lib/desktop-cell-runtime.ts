import { invoke, isTauri } from "@tauri-apps/api/core";

import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";

import { watchCodexSetup } from "./codex-setup-progress";
import { RELAY_URL } from "./config";
import { isDesktopNativeCell } from "./desktop-cell-runtime-selection";

export { isDesktopNativeCell } from "./desktop-cell-runtime-selection";

export async function ensureDesktopCells(
  snapshot: WorkspaceSnapshot,
  workspace: Pick<RelayClient, "loadAgentConfigs" | "registerAgentKey">,
) {
  if (!isTauri()) return;
  const onDevice = new Set(
    snapshot.agents
      .filter(
        (agent) =>
          agent.runtime.kind === "native-cell" &&
          agent.canRunOnDevice !== false,
      )
      .flatMap((agent) => [agent.id, ...agent.subagents.map(({ id }) => id)]),
  );
  const configurations = (await workspace.loadAgentConfigs()).filter(
    ({ agentId }) => onDevice.has(agentId),
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
