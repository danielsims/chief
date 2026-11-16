import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import { authoredAgentDefinitions } from "@chief/agent-runtime/agent-definitions";
import { renderChiefIdentity } from "@chief/agent-runtime/prompts";

const authored = authoredAgentDefinitions.find((agent) => agent.id === "chief");
if (!authored) throw new Error("Chief's authored agent definition is missing.");
const template = authored.instructions;

/** Chief's identity, rendered from the workspace's kind and current team. */
export function workspaceChiefInstructions(
  workspace: Pick<WorkspaceSnapshot, "name" | "purpose" | "companyName">,
  team: readonly { id: string; name: string; description: string }[],
) {
  return renderChiefIdentity(template, {
    purpose: workspace.purpose,
    workspaceName: workspace.name,
    companyName: workspace.companyName,
    team,
  });
}
