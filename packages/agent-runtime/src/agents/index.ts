import type { AgentDefinition } from "../types.js";
import { composeWorkspaceInstructions } from "../prompts/index.js";
import { generatedAgentDefinitions } from "./instructions.generated.js";

export { composeWorkspaceInstructions };
export type { AgentDefinition } from "../types.js";

/**
 * Agent definitions composed from the authored per-agent manifests and
 * instructions. The instruction text is generated from each agent's
 * instructions.md so the same definitions work in the Cloudflare Worker DO
 * (no node:fs) and the desktop runtime. Regenerate with
 * `generate:agent-instructions` after editing a persona.
 */
export const defaultAgents: AgentDefinition[] = generatedAgentDefinitions;

export function getAgent(id: string): AgentDefinition | undefined {
  return defaultAgents.find((a) => a.id === id);
}
