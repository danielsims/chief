import { isJsonString } from "@chief/relay-contracts";

/**
 * Approval policy: which tool calls run without asking and which need the
 * user's explicit approval. Follows the executor.sh semantics: reads and
 * probes auto-run, anything that mutates the machine or the outside world
 * asks first, so the safe path is the default.
 *
 * This is deliberately a standalone seam. Drivers ask it for a decision and
 * only surface a permission event when the answer is "ask" — swapping the
 * policy (per-workspace settings, an executor.sh-backed toolset registry)
 * never touches driver code.
 */

export type ApprovalDecision = "allow" | "ask";

/** Tools that only observe state and are always safe to run. */
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "NotebookRead",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
]);

/**
 * Shell commands that only probe or read: existence and version checks,
 * plain listings, architecture queries. Matched against each segment of a
 * compound command so `foo && bar` is only allowed when every part is safe.
 */
const SAFE_COMMAND_PATTERNS: RegExp[] = [
  /^command -v\s/,
  /^which\s/,
  /^type\s/,
  /^[\w./-]+\s+--version$/,
  /^[\w./-]+\s+-v$/,
  /^uname(\s|$)/,
  /^pwd$/,
  /^echo\s/,
  /^printf\s/,
  /^ls(\s|$)/,
  /^cat\s/,
  /^head(\s|$)/,
  /^tail(\s|$)/,
  /^wc(\s|$)/,
  /^grep\s/,
  /^find\s/,
  /^stat\s/,
  /^env$/,
  /^date(\s|$)/,
  // Plain fetches without writing to disk or sending data.
  /^curl\s(?!.*(-X|--request|--data|-d\s|-F\s|-T\s|--upload-file|-o\s|-O(\s|$)|--output))/,
  /^npx\s+-y\s+integrations\s/,
];

function stripWrappers(command: string): string {
  // Drivers commonly wrap commands in a login shell; evaluate what actually runs.
  const match = /^\/bin\/(?:z|ba)?sh\s+-l?c\s+'([\s\S]*)'$/.exec(command);
  return (match?.[1] ?? command).trim();
}

function isSafeShellCommand(command: string): boolean {
  const inner = stripWrappers(command);
  // Compound commands are safe only when every segment is.
  const segments = inner
    .split(/&&|\|\||;|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) =>
    SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(segment)),
  );
}

export function evaluateToolUse(
  toolName: string,
  input: unknown,
  cwd: string,
): ApprovalDecision {
  if (READ_ONLY_TOOLS.has(toolName)) return "allow";

  const i = (input ?? {}) as Record<string, unknown>;

  // File edits inside the agent's own working directory are workspace-scoped
  // and reversible; edits anywhere else on the machine need approval.
  if (
    toolName === "Edit" ||
    toolName === "Write" ||
    toolName === "NotebookEdit"
  ) {
    const path = isJsonString(i.file_path) ? i.file_path : "";
    return path.startsWith(cwd) ? "allow" : "ask";
  }

  if (toolName === "Bash" || toolName === "bash") {
    const command = isJsonString(i.command) ? i.command : "";
    return isSafeShellCommand(command) ? "allow" : "ask";
  }

  return "ask";
}
