import { randomUUID } from "node:crypto";

import type { WorkspaceSchedule } from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  automationCardPayloadSchema,
} from "@chief/relay-contracts";

import type { RelayCellContext } from "./context.js";
import { deterministicUuid } from "../relay-cell-ids.js";

/**
 * Shows an automation the agent just saved in the conversation it was asked
 * for in. There is one card per automation per thread: the card reads the
 * automation live, so a revision updates the card already there rather than
 * posting another. A card that can't be posted never undoes the save.
 * Showing one on request always posts a new card, so it lands where the
 * person is reading rather than further up the thread.
 */
export async function postAutomationCard(
  context: RelayCellContext,
  automation: Pick<WorkspaceSchedule, "id" | "title">,
  { fresh = false }: { fresh?: boolean } = {},
) {
  const { client, workspaceId, agentId, conversationId, threadRootId } =
    context;
  const messageId = fresh
    ? randomUUID()
    : deterministicUuid(
        `${workspaceId}:${agentId}:${conversationId}:${threadRootId ?? ""}:automation-card:${automation.id}`,
      );
  try {
    await client.appendMessage(
      conversationId,
      appendMessageCommandSchema.parse({
        commandId: messageId,
        protocolVersion: 1,
        occurredAt: new Date().toISOString(),
        payload: {
          messageId,
          conversationId,
          threadRootId,
          body: "",
          mentions: [],
          components: [
            {
              id: deterministicUuid(`${messageId}:component`),
              kind: "automation",
              version: 1,
              payload: automationCardPayloadSchema.parse({
                workspaceId,
                conversationId,
                threadRootId,
                agentId,
                automationId: automation.id,
                title: automation.title,
              }),
            },
          ],
        },
      }),
    );
    return "The person can see, edit, and approve this automation on a card in this conversation, so don't repeat its details or link to it.";
  } catch (error) {
    console.error("[cell] automation card:", error);
    return undefined;
  }
}
