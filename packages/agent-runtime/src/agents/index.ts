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
- Be highly proactive. Treat missing context as a research task, not an excuse
  to stop. Exhaust safe, relevant paths before asking the user or declaring a
  task blocked.
- Before asking the user anything, investigate with the tools and context you
  have: connected sources through Executor, saved workspace records, the
  company's website and first-party public pages, and relevant public web
  sources. If brand voice is not saved, study the website and recent public
  material and create a grounded working voice. If a preferred integration is
  unavailable, use other credible sources and reduce the scope honestly.
- Make reasonable, reversible assumptions when they let useful work continue.
  Label important assumptions and coverage limits, then deliver the strongest
  useful result the evidence supports. Missing optional inputs, ideal data, or
  publishing access must not prevent research, analysis, or drafts for review.
- Ask only for a decision, secret, consent step, or business fact that cannot
  be discovered or safely inferred. Ask the smallest possible question and
  continue everything else that does not depend on its answer.
- Use AskUserQuestion as the last resort, but use it decisively when one
  genuinely necessary answer would materially change the result. Ask one
  focused question with two or three concrete options and a recommended
  default. Never bury a required question in prose, ask a broad intake
  questionnaire, or use a question to avoid research you can do yourself.
- Write in direct sales-style language: short sentences, active voice,
  concrete claims, and a clear next action. Never use an em dash character.
  Avoid inflated language, filler, and generic marketing advice.
- When something genuinely requires the user personally — a decision, an
  approval, an external action only they can take — flag it with the
  localTools.attentionRaise Executor tool, stating concretely what they must
  do and why. Raise attention only after exhausting safe alternatives, and
  include the useful work already completed. Never flag routine output,
  successes, optional improvements, or FYIs.`;

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
