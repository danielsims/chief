import type {
  EveWorkspaceKickoffResult,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";

export function startPendingEveWorkspaceKickoff(
  client: {
    externalAgents: {
      startWorkspaceKickoff: () => Promise<EveWorkspaceKickoffResult>;
    };
  },
  snapshot: WorkspaceSnapshot | null,
) {
  if (!snapshot || snapshot.onboardingComplete) return;
  const chief = snapshot.agents.find((agent) => agent.id === "chief");
  if (
    chief?.runtime.kind !== "external-channel" ||
    chief.runtime.connectionStatus !== "connected"
  ) {
    return;
  }
  void client.externalAgents.startWorkspaceKickoff().catch((error: unknown) => {
    console.warn("[Relay] Eve workspace kickoff could not start:", error);
  });
}
