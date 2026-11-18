import {
  databaseRowSaveSchema,
  databaseSaveSchema,
} from "@chief/relay-contracts";

import { postCellCard } from "../cards.js";
import { optionalString, requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

/** The same database tools hosted agents have, through the relay. */
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
  defineRelayCellTool(
    "databases.read",
    "workspace.read",
    async ({ client }, input) =>
      await client.databases.get(requiredString(input, "databaseId")),
  ),
  defineRelayCellTool(
    "databases.save",
    "workspace.write",
    async ({ client, conversationId }, input) => {
      const id = optionalString(input, "id");
      // A new database shows in the conversation the agent is working in.
      const channels = Array.isArray(input.channelIds)
        ? input.channelIds
        : id
          ? undefined
          : [conversationId];
      return await client.databases.save(
        databaseSaveSchema.parse({
          id,
          channels,
          name: optionalString(input, "name"),
          fields: input.fields,
          views: input.views,
        }),
      );
    },
  ),
  defineRelayCellTool(
    "databases.rows.save",
    "workspace.write",
    async ({ client, conversationId, threadRootId }, input) => {
      const id = optionalString(input, "id");
      return await client.databases.saveRow(
        requiredString(input, "databaseId"),
        databaseRowSaveSchema.parse({
          id,
          values: input.values,
          match: input.match,
          body: optionalString(input, "body"),
          // New rows link back to the thread they came from.
          ...(!id
            ? {
                source: {
                  kind: "thread",
                  conversationId,
                  ...(threadRootId ? { threadRootId } : undefined),
                },
              }
            : undefined),
        }),
      );
    },
  ),
  defineRelayCellTool(
    "databases.show",
    "workspace.read",
    async (context, input) => {
      const databaseId = requiredString(input, "databaseId");
      const { database } = await context.client.databases.get(databaseId);
      const view =
        optionalString(input, "view") === "board" &&
        database.views.some((candidate) => candidate.layout === "board")
          ? "board"
          : "table";
      await postCellCard(context, "database", {
        databaseId,
        view,
        title: database.name,
      });
      return {
        shown: database.name,
        view,
        card: "The person can see and edit this database on a card in this conversation, so don't repeat its rows.",
      };
    },
  ),
];
