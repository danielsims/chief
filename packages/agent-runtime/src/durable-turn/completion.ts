import { isJsonObject } from "@chief/relay-contracts";

import type { DurableTurn } from "./types.js";
import { completionReminder, hasOpenTasks, isTodoTool } from "./plan.js";

type FinishTurn =
  | { kind: "completed"; result: string }
  | { kind: "failed"; error: string }
  | { kind: "retry"; message: string; rejectedFinishes?: number };

export function finishTurn(turn: DurableTurn, result: string): FinishTurn {
  const missing = completionRequirements(turn);
  if (missing.length > 0) return missingRequirementsFinish(turn, missing);
  if (!hasOpenTasks(turn.plan)) return { kind: "completed", result };
  if (repeatsLastFinishAttempt(turn, result)) {
    return {
      kind: "failed",
      error:
        "Agent stopped after repeating the same final response without advancing its durable plan.",
    };
  }
  return { kind: "retry", message: completionReminder(turn.plan) };
}

export function completionRequirements(turn: DurableTurn) {
  const completed = new Set(
    turn.tools.flatMap((receipt) =>
      receipt.state === "completed" && receiptSucceeded(receipt.result)
        ? [receipt.call.name]
        : [],
    ),
  );
  const unavailable = new Set(
    turn.tools.flatMap((receipt) =>
      receipt.state === "completed" && receiptUnavailable(receipt.result)
        ? [receipt.call.name]
        : [],
    ),
  );
  const missing = turn.completion.requiredToolNames.filter(
    (name) => !completed.has(name) && !unavailable.has(name),
  );
  if (
    turn.completion.browserMustRemainOpen &&
    !unavailable.has("browser_open")
  ) {
    const browserLifecycle = latestBrowserLifecycle(turn.tools);
    if (browserLifecycle !== "browser_open") {
      missing.push("leave the requested browser page open for the user");
    }
  }
  return [...new Set(missing)];
}

export function repeatedCompletedTool(tools: DurableTurn["tools"]) {
  const completed = tools.filter(
    (receipt) =>
      receipt.state === "completed" && !isTodoTool(receipt.call.name),
  );
  const latest = completed.at(-1);
  if (!latest) return 0;
  const signature = toolReceiptSignature(latest);
  return completed.filter(
    (receipt) => toolReceiptSignature(receipt) === signature,
  ).length;
}

function receiptSucceeded(result: DurableTurn["tools"][number]["result"]) {
  return !isJsonObject(result) || result.ok !== false;
}

function receiptUnavailable(result: DurableTurn["tools"][number]["result"]) {
  return isJsonObject(result) && result.unavailableForTurn === true;
}

function missingRequirementsFinish(
  turn: DurableTurn,
  missing: readonly string[],
): FinishTurn {
  const rejectedFinishes = turn.completion.rejectedFinishes + 1;
  if (rejectedFinishes >= 3) {
    return {
      kind: "failed",
      error: `Agent stopped after repeatedly claiming completion without satisfying: ${missing.join(", ")}.`,
    };
  }
  return {
    kind: "retry",
    rejectedFinishes,
    message: `The requested action is not complete. Before answering, satisfy: ${missing.join(", ")}. Perform the action now; do not return another promise or progress update.`,
  };
}

export function repeatsLastFinishAttempt(turn: DurableTurn, result: string) {
  for (let index = turn.messages.length - 1; index >= 0; index -= 1) {
    const message = turn.messages[index];
    if (!message || message.role === "system") continue;
    if (message.role !== "assistant" || message.toolCalls?.length) return false;
    return normalizedFinish(message.content) === normalizedFinish(result);
  }
  return false;
}

function latestBrowserLifecycle(tools: DurableTurn["tools"]) {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const receipt = tools[index];
    if (
      receipt?.state === "completed" &&
      (receipt.call.name === "browser_open" ||
        receipt.call.name === "browser_close")
    ) {
      return receipt.call.name;
    }
  }
  return undefined;
}

function toolReceiptSignature(receipt: DurableTurn["tools"][number]) {
  return JSON.stringify([
    receipt.call.name,
    receipt.call.arguments,
    receipt.result,
  ]);
}

function normalizedFinish(value: string | null) {
  return value?.trim().replace(/\s+/gu, " ") ?? "";
}
