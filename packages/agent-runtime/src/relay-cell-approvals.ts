import type { RelayClient } from "@chief/relay-client";
import {
  appendMessageCommandSchema,
  parseJsonObject,
  parseJsonString,
} from "@chief/relay-contracts";

import { deterministicUuid } from "./relay-cell-ids.js";

/** How long a run waits for someone to answer an approval. */
export const APPROVAL_WAIT_MS = 10 * 60_000;

const ALLOW = "Allow";
const DENY = "Deny";

/** What an agent wants to do, in a line a person can judge. */
export function approvalSummary<Input>(toolName: string, input: Input) {
  const fields = parseJsonObject(input);
  const command = parseJsonString(fields?.command);
  if (command) return { action: "run a command", detail: command };
  const path =
    parseJsonString(fields?.file_path) ??
    parseJsonString(fields?.path) ??
    parseJsonString(fields?.filePath);
  if (path) return { action: `use ${toolName} on a file`, detail: path };
  return { action: `use ${toolName}`, detail: undefined };
}

/** An answer is an approval only when it plainly says so. */
export function approvalGranted(answer: string | undefined) {
  return answer?.trim().toLowerCase() === ALLOW.toLowerCase();
}

/**
 * Asks in the run's thread whether the agent may go ahead, as a question card
 * whose options post the answer back into the thread.
 */
export async function askForApproval(
  client: RelayClient,
  input: {
    workspaceId: string;
    agentId: string;
    conversationId: string;
    threadRootId?: string;
    requestId: string;
    toolName: string;
    toolInput: unknown;
  },
) {
  const { action, detail } = approvalSummary(input.toolName, input.toolInput);
  const question = detail
    ? `Can I ${action} on this machine?\n\n\`\`\`\n${detail.slice(0, 1_500)}\n\`\`\``
    : `Can I ${action} on this machine?`;
  const commandId = deterministicUuid(
    `${input.workspaceId}:${input.agentId}:approval:${input.requestId}`,
  );
  await client.appendMessage(
    input.conversationId,
    appendMessageCommandSchema.parse({
      commandId,
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        messageId: commandId,
        conversationId: input.conversationId,
        ...(input.threadRootId
          ? { threadRootId: input.threadRootId }
          : undefined),
        body: question,
        mentions: [],
        components: [
          {
            id: deterministicUuid(`${commandId}:question`),
            kind: "question",
            version: 1,
            payload: {
              workspaceId: input.workspaceId,
              conversationId: input.conversationId,
              ...(input.threadRootId
                ? { threadRootId: input.threadRootId }
                : undefined),
              agentId: input.agentId,
              question,
              options: [ALLOW, DENY],
            },
          },
        ],
      },
    }),
  );
}
