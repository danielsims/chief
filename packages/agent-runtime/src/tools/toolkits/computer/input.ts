import { z } from "zod";

import type { AgentComputer } from "@chief/agent-computer";

import { boundedText } from "../../input.js";

export const computerPathSchema = boundedText(2_000).transform(
  (source, context) => {
    const path =
      source === "/"
        ? "/workspace"
        : source.startsWith("/")
          ? source
          : `/workspace/${source}`;
    if (
      (path === "/workspace" || path.startsWith("/workspace/")) &&
      !path.split("/").includes("..")
    ) {
      return path;
    }
    context.addIssue({
      code: "custom",
      message: "path must stay inside /workspace.",
    });
    return z.NEVER;
  },
);

export function requireComputer(context: { computer?: AgentComputer }) {
  if (!context.computer) throw new Error("The agent computer is unavailable.");
  return context.computer;
}

export function boundedComputerOutput(value: string) {
  return value.length > 40_000
    ? `${value.slice(0, 40_000)}\n[truncated]`
    : value;
}
