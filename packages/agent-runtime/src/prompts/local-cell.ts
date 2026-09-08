import { composeAgentPrompt } from "./index.js";

export interface LocalCellInstructionContext {
  identity: string;
  permissions: readonly string[];
  conversationKind: "channel" | "direct";
  workspaceContext: string;
  workingDirectory: string;
  homeDirectory: string;
  project?: { name: string; projectId: string; directory: string } | null;
}

export function localCellInstructions(context: LocalCellInstructionContext) {
  const shared = composeAgentPrompt(context.identity, {
    permissions: context.permissions,
    deployment: "desktop",
    conversationKind: context.conversationKind,
    workspaceContext: context.workspaceContext,
  });
  return `${shared}\n\n# Local execution context\n\n${localCellExecutionContext(context)}`;
}

export function localCellExecutionContext(
  context: Pick<
    LocalCellInstructionContext,
    "workingDirectory" | "homeDirectory" | "project"
  >,
) {
  return [
    "You are running on the user's computer through Chief's local agent runtime. The relay coordinates workspace messages; it is not the machine executing your native filesystem and shell tools.",
    `Home directory: ${JSON.stringify(context.homeDirectory)}. Working directory: ${JSON.stringify(context.workingDirectory)}. The working directory is a starting location, not a statement that other paths cannot be read.`,
    "Use your native file and shell tools to inspect user-requested local files. Resolve Desktop and Documents relative to the home directory. Test the specific requested path before claiming access is unavailable. Distinguish a missing path from a permission denial. Local reads do not require a relay project, mission, plugin, or a handoff to another agent.",
    "Follow the provider's actual filesystem and approval policy. Read access does not imply write access. If an operation is denied, report that specific operation and continue any permitted work; do not bypass the restriction or claim the whole computer is inaccessible.",
    context.project
      ? `Repository: ${context.project.name} (${context.project.projectId}). Make code changes in the prepared isolated checkout ${JSON.stringify(context.project.directory)}, inspect its repository instructions, and run focused checks. Return the diff and evidence for review.`
      : "No isolated repository checkout is assigned to this turn. You can still inspect a user-specified repository. Before editing, establish the intended working copy and the permitted write scope. Use a connected project checkout when available; do not claim that project registration is required to read local files.",
    "Use only tools actually present in this session. Chief's MCP tools handle relay workspace data; native provider tools handle local files and commands. Older examples using localTools or dotted names are not proof those tools exist. Do not ask the user to install a connector for a task your native tools already support.",
    "When asked to debug Chief or its prompts, inspect the user-owned source and configuration files and explain the concrete behavior they implement. This is an ordinary code review, not a request to disclose hidden provider instructions. Keep credentials and unrelated private content out of replies.",
    "Do not push, deploy, or change an original checkout without the user's authorization. Reply directly to the user in a direct conversation; no Chief handoff or mission is required for ordinary local work.",
  ].join("\n\n");
}
