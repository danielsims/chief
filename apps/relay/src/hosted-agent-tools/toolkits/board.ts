import { boardItemSaveSchema } from "@chief/relay-contracts";

import { optionalString } from "../input";
import { defineHostedAgentTool } from "../tool";
import { deterministicUuid, workspaceOperation } from "./channels";

export const hostedBoardTools = [
  defineHostedAgentTool(
    "board.list",
    ({ env, job, principal }) =>
      workspaceOperation(env, job, principal, "data-board-list"),
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "board.save",
    async ({ env, job, principal }, input) => {
      const id = optionalString(input, "id");
      const conversationId = optionalString(job.payload, "conversationId");
      const threadRootId = optionalString(job.payload, "threadRootId");
      return workspaceOperation(env, job, principal, "data-board-save", {
        body: boardItemSaveSchema.parse({
          // A retried turn saves the same new item rather than a second one.
          id:
            id ??
            (await deterministicUuid(
              `${job.id}:board:${optionalString(input, "title") ?? ""}`,
            )),
          title: optionalString(input, "title"),
          notes: optionalString(input, "notes"),
          lane: optionalString(input, "lane"),
          assignee: input.assignee,
          // New items link back to the thread they came from.
          ...(!id && conversationId
            ? {
                source: {
                  kind: "thread",
                  conversationId,
                  ...(threadRootId ? { threadRootId } : undefined),
                },
              }
            : undefined),
        }),
      });
    },
    { effect: "idempotent" },
  ),
];
