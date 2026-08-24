import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import type { PendingApproval } from "../../lib/runtime";

export interface ApprovalPresentation {
  kind: "command" | "file-change" | "plugin" | "tool";
  eyebrow: string;
  title: string;
  description: string;
  detail?: string;
  detailLabel?: string;
  allowLabel: string;
  denyLabel: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && isJsonObject(value) && !Array.isArray(value)
    ? (value)
    : {};
}

function firstString(
  value: unknown,
  keys: readonly string[],
  depth = 0,
): string | undefined {
  if (depth > 4) return undefined;
  const object = record(value);
  for (const key of keys) {
    const candidate = object[key];
    if (isJsonString(candidate) && candidate.trim()) {
      return candidate.trim();
    }
    if (
      Array.isArray(candidate) &&
      candidate.every((item) => isJsonString(item))
    ) {
      return candidate.join(" ").trim() || undefined;
    }
  }
  for (const nested of Object.values(object)) {
    const candidate = firstString(nested, keys, depth + 1);
    if (candidate) return candidate;
  }
  return undefined;
}

const SECRET_KEY = /authorization|cookie|credential|password|secret|token/i;

function safeApprovalValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return "…";
  if (isJsonString(value)) {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (!value || !isJsonObject(value)) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 6).map((item) => safeApprovalValue(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) => !["threadId", "turnId", "requestedSchema"].includes(key),
      )
      .slice(0, 10)
      .map(([key, item]) => [
        key,
        SECRET_KEY.test(key)
          ? "[protected]"
          : safeApprovalValue(item, depth + 1),
      ]),
  );
}

function fallbackDetail(input: unknown) {
  const detail = JSON.stringify(safeApprovalValue(input), null, 2);
  return detail && detail !== "{}" ? detail.slice(0, 1_200) : undefined;
}

function friendlyToolName(toolName: string) {
  if (toolName === "bash") return "a command";
  if (toolName === "fileChange") return "files";
  if (toolName === "Executor tool") return "a connected tool";
  return toolName
    .replace(/^tools\./, "")
    .replace(/[_.-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function approvalPresentation(
  approval: Pick<PendingApproval, "input" | "toolName">,
): ApprovalPresentation {
  const input = record(approval.input);
  const meta = record(input._meta);
  const approvalKind = isJsonString(meta.codex_approval_kind)
    ? meta.codex_approval_kind
    : "";
  const message = firstString(input, [
    "suggest_reason",
    "message",
    "reason",
    "justification",
    "description",
  ]);

  if (approvalKind === "tool_suggestion") {
    const toolName =
      firstString(meta, ["tool_name", "toolName"]) ?? approval.toolName;
    return {
      kind: "plugin",
      eyebrow: "Connection requested",
      title: `Add ${toolName} to this agent?`,
      description:
        message ??
        `This would let the agent use the ${toolName} connection for this work.`,
      detail: `The agent is asking to add the ${toolName} plugin. No repository action will run until the connection is available.`,
      detailLabel: "What will happen",
      allowLabel: `Add ${toolName}`,
      denyLabel: "Not now",
    };
  }

  if (approval.toolName === "fileChange") {
    return {
      kind: "file-change",
      eyebrow: "File approval",
      title: "Apply these file changes?",
      description:
        message ?? "The agent wants to change files in this workspace.",
      detail: fallbackDetail(input),
      detailLabel: "Requested change",
      allowLabel: "Apply changes",
      denyLabel: "Don’t apply",
    };
  }

  const command = firstString(input, ["command", "cmd", "code"]);
  if (approval.toolName === "bash" || command) {
    return {
      kind: "command",
      eyebrow: "Command approval",
      title: "Run this command?",
      description:
        message ?? "The agent wants to run this command on your computer.",
      detail: command ?? fallbackDetail(input),
      detailLabel: "Command",
      allowLabel: "Run command",
      denyLabel: "Don’t run",
    };
  }

  const toolName = friendlyToolName(approval.toolName);
  return {
    kind: "tool",
    eyebrow: "Tool approval",
    title: `Use ${toolName}?`,
    description: message ?? `The agent wants to use ${toolName} for this work.`,
    detail: command ?? fallbackDetail(input),
    detailLabel: command ? "Action" : "Request details",
    allowLabel: "Allow once",
    denyLabel: "Deny",
  };
}

export function approvalBelongsToSurface(
  approval: Pick<PendingApproval, "threadRootId">,
  threadRootId: string | null,
) {
  return threadRootId
    ? approval.threadRootId === threadRootId
    : !approval.threadRootId;
}
