import { composeAgentPrompt } from "./index.js";

export interface LocalCellInstructionContext {
  identity: string;
  permissions: readonly string[];
  conversationKind: "channel" | "direct";
  workspaceContext: string;
  workingDirectory: string;
  homeDirectory: string;
  project?: { name: string; projectId: string; directory: string } | null;
  /** Operating system name, such as macOS. */
  operatingSystem?: string;
  /** Inference provider and model, such as "Codex (gpt-5.5)". */
  provider?: string;
  approvals?: "auto" | "ask";
  unattended?: boolean;
}

export function localCellInstructions(context: LocalCellInstructionContext) {
  const shared = composeAgentPrompt(context.identity, {
    permissions: context.permissions,
    deployment: "desktop",
    conversationKind: context.conversationKind,
    workspaceContext: context.workspaceContext,
    unattended: context.unattended,
  });
  return `${shared}\n\n# Execution context\n\n${localCellExecutionContext(context)}`;
}

export function localCellExecutionContext(
  context: Pick<
    LocalCellInstructionContext,
    | "workingDirectory"
    | "homeDirectory"
    | "project"
    | "operatingSystem"
    | "provider"
    | "approvals"
  >,
) {
  const machine = context.operatingSystem
    ? `a ${context.operatingSystem} computer`
    : "the person's computer";
  return [
    `You're running on ${machine} through the Chief desktop app${context.provider ? `, using ${context.provider}` : ""}. Your file and shell tools operate directly on this machine.`,
    `Your home directory is ${JSON.stringify(context.homeDirectory)}, and you're starting in ${JSON.stringify(context.workingDirectory)}. You can read files outside the starting folder, and Desktop and Documents are within the home directory.`,
    context.project
      ? `You're working in ${context.project.name} (${context.project.projectId}). Make your changes in your checkout at ${JSON.stringify(context.project.directory)}, follow the repository's instructions, run the relevant checks and share the diff.`
      : "No repository checkout is assigned to this task. You can read any repository the person points you to, but confirm which copy you're allowed to change before editing it.",
    context.approvals === "auto"
      ? "You can run commands and edit files on this computer without asking first."
      : "Chief's own tools run immediately. Anything else asks the person for approval in this thread, and unattended runs can't ask, so those actions will be refused.",
    "If an action is denied, say specifically what was blocked and continue with the rest of the work.",
  ].join("\n\n");
}
