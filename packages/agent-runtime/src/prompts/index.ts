/**
 * Prompt router. Composes an agent's system prompt from small atomic parts
 * using the exact capabilities, tool permissions, deployment target and
 * conversation shape for the current run.
 *
 * This is the single source of a worker-safe system prompt. Both the desktop
 * runtime and the hosted Cloudflare Worker Durable Object must use this so an
 * agent behaves the same wherever its cell runs.
 */
import type { PromptContext } from "./types.js";
import { promptParts } from "./parts/index.js";

export type { PromptContext } from "./types.js";

export interface AssembledPrompt {
  /** Ordered list of included parts, for diagnostics and tests. */
  parts: readonly { id: string; summary: string }[];
  /** The final system prompt text. */
  text: string;
}

export function assembleAgentPrompt(context: PromptContext): AssembledPrompt {
  const included = promptParts.filter((part) =>
    context.includeAll === true ? true : part.when(context),
  );
  const sections = [
    context.identity.trim(),
    ...included.map((part) => part.render()),
  ];
  const workspace = context.workspaceContext?.trim();
  if (workspace) sections.push(`# Workspace\n\n${workspace}`);
  return {
    parts: included.map((part) => ({ id: part.id, summary: part.summary })),
    text: sections.filter(Boolean).join("\n\n"),
  };
}

export function composeAgentPrompt(
  identity: string,
  context: {
    capabilities?: readonly string[];
    permissions?: readonly string[];
    deployment: "phone" | "desktop" | "cloud";
    conversationKind?: PromptContext["conversationKind"];
    channel?: PromptContext["channel"];
    operatingMode?: PromptContext["operatingMode"];
    workspaceContext?: string;
  },
): string {
  return assembleAgentPrompt({ identity, ...context }).text;
}

/**
 * Legacy entry point used by the desktop runtime and tests. It historically
 * appended every shared operating rule to a persona regardless of context, so
 * it routes through the router with `includeAll` to keep exactly that breadth
 * while still ordering through the atomic parts.
 */
export function composeWorkspaceInstructions(
  instructions: string,
  workspaceContext?: string,
): string {
  return assembleAgentPrompt({
    identity: instructions,
    deployment: "desktop",
    includeAll: true,
    workspaceContext,
  }).text;
}
