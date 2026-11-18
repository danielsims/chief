import type { BrowserRunRecord } from "@chief/agent-runtime/types";
import type { ConversationMessage } from "@chief/relay-contracts";
import { isJsonString } from "@chief/relay-contracts";

/**
 * Agents' browsers, as their cards in conversations record them, so a
 * conversation's history keeps each browser session where it happened.
 */
export class BrowserRunLedger {
  private readonly runs = new Map<string, BrowserRunRecord>();

  remember(message: ConversationMessage) {
    const run = browserRunRecord(
      message,
      this.runs.get(browserRunId(message) ?? ""),
    );
    if (run) this.runs.set(run.id, run);
  }

  /** Every browser run seen, as the message the app's runtime reads. */
  message(workspaceId: string) {
    return {
      type: "browserRuns" as const,
      workspaceId,
      runs: [...this.runs.values()],
    };
  }
}

function browserComponent(message: ConversationMessage) {
  return message.author.kind === "agent"
    ? message.components.find(
        (candidate) => candidate.kind === "browser" && candidate.version === 1,
      )
    : undefined;
}

function browserRunId(message: ConversationMessage) {
  const id = browserComponent(message)?.payload.browserRunId;
  return isJsonString(id) ? id : undefined;
}

/**
 * The browser run an agent's browser card records, for the conversation's
 * history: where it was opened, the page it showed and whether it's ended.
 */
function browserRunRecord(
  message: ConversationMessage,
  known: BrowserRunRecord | undefined,
): BrowserRunRecord | undefined {
  const component = browserComponent(message);
  const id = browserRunId(message);
  if (!component || !id) return undefined;
  const url = isJsonString(component.payload.url)
    ? component.payload.url
    : (known?.url ?? "");
  const createdAt = known?.createdAt ?? Date.parse(message.createdAt);
  return {
    id,
    workspaceId: message.workspaceId,
    conversationId: message.conversationId,
    ...(message.threadRootId
      ? { threadRootId: message.threadRootId }
      : undefined),
    anchorMessageId: known?.anchorMessageId ?? message.id,
    url,
    status: component.payload.status === "active" ? "active" : "complete",
    createdAt,
    updatedAt: Date.parse(message.createdAt),
  };
}
