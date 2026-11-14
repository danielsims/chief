import { createHash } from "node:crypto";

import {
  databaseRowSaveSchema,
  databaseSaveSchema,
} from "@chief/relay-contracts";

import { optionalString, requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

function stableId(key: string) {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Chief databases are workspace boards, independent of any Notion connection. */
export const relayCellDatabaseTools = [
  defineRelayCellTool(
    "databases.list",
    "workspace.read",
    async ({ client }, input) => ({
      databases: await client.databases.list(
        optionalString(input, "channelId"),
      ),
    }),
  ),
  defineRelayCellTool("databases.read", "workspace.read", ({ client }, input) =>
    client.databases.get(requiredString(input, "databaseId")),
  ),
  defineRelayCellTool(
    "databases.save",
    "workspace.write",
    async ({ client, workspaceId, agentId, conversationId }, input) => {
      const id = optionalString(input, "id");
      const channels = Array.isArray(input.channelIds)
        ? input.channelIds
        : undefined;
      return client.databases.save(
        databaseSaveSchema.parse({
          id:
            id ??
            stableId(
              `${workspaceId}:${agentId}:${conversationId}:database:${optionalString(input, "name") ?? ""}`,
            ),
          name: optionalString(input, "name"),
          fields: input.fields,
          views: input.views,
          // Existing database channel assignments stay unchanged unless supplied.
          channels: channels ?? (id ? undefined : [conversationId]),
        }),
      );
    },
  ),
  defineRelayCellTool(
    "databases.rows.save",
    "workspace.write",
    async (
      { client, workspaceId, agentId, conversationId, threadRootId },
      input,
    ) => {
      const databaseId = requiredString(input, "databaseId");
      const id = optionalString(input, "id");
      return client.databases.saveRow(
        databaseId,
        databaseRowSaveSchema.parse({
          id:
            id ??
            stableId(
              `${workspaceId}:${agentId}:${conversationId}:${threadRootId ?? ""}:${databaseId}:row:${JSON.stringify(input.match ?? input.values ?? {})}`,
            ),
          values: input.values,
          match: input.match,
          body: optionalString(input, "body"),
          source: id
            ? undefined
            : {
                kind: "thread",
                conversationId,
                threadRootId,
              },
        }),
      );
    },
  ),
];
