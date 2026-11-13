import { invoke, isTauri } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";

import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";

import { watchCodexSetup } from "./codex-setup-progress";
import { RELAY_URL } from "./config";
import { registerDesktopAgentKeys } from "./desktop-agent-reconnect";
import { isDesktopNativeCell } from "./desktop-cell-runtime-selection";

export { isDesktopNativeCell } from "./desktop-cell-runtime-selection";

const startingWorkspaces = new Map<string, Promise<void>>();

export async function ensureDesktopCells(
  snapshot: WorkspaceSnapshot,
  workspace: Pick<RelayClient, "loadAgentConfigs" | "registerAgentKey">,
) {
  if (!isTauri()) return;
  const pending = startingWorkspaces.get(snapshot.id);
  if (pending) return pending;
  const starting = startDesktopCells(snapshot, workspace);
  startingWorkspaces.set(snapshot.id, starting);
  try {
    await starting;
  } finally {
    startingWorkspaces.delete(snapshot.id);
  }
}

async function startDesktopCells(
  snapshot: WorkspaceSnapshot,
  workspace: Pick<RelayClient, "loadAgentConfigs" | "registerAgentKey">,
) {
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
        return { agentId, config, pubkey };
      }),
  );
  const registered = await registerDesktopAgentKeys(agents, workspace, (ids) =>
    ask(
      `Chief needs to reconnect ${ids.length === 1 ? "an agent" : `${ids.length} agents`} to this Mac. Their saved identities no longer match.\n\nReconnect them here? Any other computer using these agent identities will lose access. Your conversations and settings will be kept.`,
      {
        title: "Reconnect agents",
        kind: "warning",
        okLabel: "Reconnect",
        cancelLabel: "Later",
      },
    ),
  );
  const ready = agents
    .filter(({ agentId }) => registered.has(agentId))
    .map(({ agentId, config }) => ({ agentId, config }));
  await invoke("start_workspace_cells", {
    relayUrl: RELAY_URL,
    workspaceId: snapshot.id,
    agents: ready,
  });
  for (const { agentId, config } of ready) {
    if (config.inference.provider === "codex")
      watchCodexSetup(RELAY_URL, snapshot.id, agentId);
  }
}
