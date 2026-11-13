import type {
  CreateWorkspaceCommand,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import { authoredAgentDefinitions } from "@chief/agent-runtime/agent-definitions";
import { onboardingAgents } from "@chief/relay-contracts";

import { workspaceChiefInstructions } from "./workspace-chief-instructions";
import { defaultWorkspaceAgents } from "./workspace-defaults";

export function onboardingRoster(
  input: CreateWorkspaceCommand,
): WorkspaceSnapshot["agents"] {
  if (!input.selectedAgentIds && !input.purpose)
    return structuredClone(defaultWorkspaceAgents);
  const purpose = input.purpose ?? "company";
  const requested = new Set(
    input.selectedAgentIds ??
      onboardingAgents.filter((a) => a.purpose === purpose).map((a) => a.id),
  );
  const chosen = onboardingAgents.filter(
    (a) => requested.has(a.id) && a.purpose === purpose,
  );
  const chief = structuredClone(defaultWorkspaceAgents[0]);
  return [
    {
      ...chief,
      instructions: workspaceChiefInstructions(
        chief.instructions,
        purpose,
        chosen,
      ),
      subagents: chosen.map((agent) => {
        const authored = authoredAgentDefinitions.find(
          (a) => a.id === agent.id,
        );
        return {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          description: agent.description,
          instructions:
            authored?.instructions ??
            `You are ${agent.name}, a personal workspace teammate. ${agent.description} Work from the user's actual context. Ask one clear question when needed. Do not assume a business, sales, marketing, or customer-acquisition goal. Do not claim to have researched, changed, connected, or scheduled anything without successful tool evidence. Coordinate through Chief and keep detailed work in the relevant thread.`,
          capabilities: authored?.capabilities ?? [],
        };
      }),
    },
  ];
}
