import { randomUUID } from "node:crypto";

import type { JsonObject } from "@chief/relay-contracts";
import { appendMessageCommandSchema } from "@chief/relay-contracts";

import type { RelayCellContext } from "./context.js";
import { deterministicUuid } from "../relay-cell-ids.js";

/** Posts one card where the agent is working; each call lands a new card. */
export async function postCellCard(
  context: RelayCellContext,
  kind: string,
  payload: JsonObject,
) {
  const { client, workspaceId, agentId, conversationId, threadRootId } =
    context;
  const messageId = randomUUID();
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
            kind,
            version: 1,
            payload: {
              workspaceId,
              conversationId,
              ...(threadRootId ? { threadRootId } : undefined),
              agentId,
              ...payload,
            },
          },
        ],
      },
    }),
  );
}
