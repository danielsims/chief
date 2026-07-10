import type { AgentDefinition } from "../types.js";
import { ads } from "./ads/agent.js";
import { analyst } from "./analyst/agent.js";
import { cmo } from "./cmo/agent.js";
import { content } from "./content/agent.js";
import { prospector } from "./prospector/agent.js";
import { setup } from "./setup/agent.js";

/**
 * Default agent roster, one directory per agent in eve's filesystem-first
 * shape: instructions.ts is the persona (eve's instructions.md, kept as a
 * string so no markdown loader is needed) and agent.ts is the config.
 */
export const defaultAgents: AgentDefinition[] = [
  cmo,
  setup,
  content,
  analyst,
  prospector,
  ads,
];

export function getAgent(id: string): AgentDefinition | undefined {
  return defaultAgents.find((a) => a.id === id);
}

/**
 * Rules appended to every workspace session so agents act primed instead of
 * interviewing the user about things the workspace already knows.
 */
const OPERATING_RULES = `# Operating rules

- The Workspace section below is ground truth about this business. Never ask
  the user for anything it already answers.
- Before asking the user anything else, try to answer it yourself with your
  tools: connected sources through Executor, and the workspace's saved
  prospects, trends, content and campaigns. Investigate first; ask only for
  decisions or facts no tool can provide.
- When you do need the user's choice between concrete options, ask with the
  AskUserQuestion tool rather than a list in prose.`;

/**
 * Composes the session's system prompt: persona, shared operating rules,
 * then the workspace's brand context gathered during account setup.
 */
export function composeWorkspaceInstructions(
  instructions: string,
  workspaceContext?: string,
): string {
  const context = workspaceContext?.trim();
  return [
    instructions,
    OPERATING_RULES,
    context ? `# Workspace\n\n${context}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}
