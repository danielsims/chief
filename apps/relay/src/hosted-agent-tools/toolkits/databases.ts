import {
  databaseRowSaveSchema,
  databaseSaveSchema,
} from "@chief/relay-contracts";

import { optionalString, requiredString } from "../input";
import { defineHostedAgentTool } from "../tool";
import { deterministicUuid, workspaceOperation } from "./channels";

export const hostedDatabaseTools = [
  defineHostedAgentTool(
    "databases.list",
    ({ env, job, principal }, input) => {
      const conversationId = optionalString(input, "channelId");
      return workspaceOperation(env, job, principal, "data-databases-list", {
        ...(conversationId ? { conversationId } : undefined),
      });
    },
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "databases.read",
    ({ env, job, principal }, input) =>
      workspaceOperation(env, job, principal, "data-database-get", {
        headers: { "x-chief-database-id": requiredString(input, "databaseId") },
      }),
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "databases.save",
    async ({ env, job, principal }, input) => {
      const id = optionalString(input, "id");
      return workspaceOperation(env, job, principal, "data-database-save", {
        body: databaseSaveSchema.parse({
          // A retried turn creates the same database rather than a second.
          id:
            id ??
            (await deterministicUuid(
              `${job.id}:database:${optionalString(input, "name") ?? ""}`,
            )),
          conversationId: optionalString(input, "channelId"),
          name: optionalString(input, "name"),
          fields: input.fields,
          views: input.views,
        }),
      });
    },
    { effect: "idempotent" },
  ),
  defineHostedAgentTool(
    "databases.rows.save",
    async ({ env, job, principal }, input) => {
      const id = optionalString(input, "id");
      const conversationId = optionalString(job.payload, "conversationId");
      const threadRootId = optionalString(job.payload, "threadRootId");
      return workspaceOperation(env, job, principal, "data-database-row-save", {
        headers: { "x-chief-database-id": requiredString(input, "databaseId") },
        body: databaseRowSaveSchema.parse({
          // A retried turn saves the same new row rather than a second one.
          id:
            id ??
            (await deterministicUuid(
              `${job.id}:row:${JSON.stringify(input.values ?? {})}`,
            )),
          values: input.values,
          match: input.match,
          body: optionalString(input, "body"),
          // New rows link back to the thread they came from.
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
