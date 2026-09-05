import { randomUUID } from "node:crypto";

import { parseJsonNumber } from "@chief/relay-contracts";

import { optionalString, requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

export const relayCellWorkspaceTools = [
  defineRelayCellTool(
    "brandProfile.status",
    "workspace.read",
    async ({ client }) => ({ profile: await client.loadBrandProfile() }),
  ),
  defineRelayCellTool(
    "brandProfile.save",
    "workspace.write",
    async ({ client, conversationId }, input) => {
      const markdown = requiredString(input, "markdown");
      return await client.saveBrandProfile({
        markdown,
        sourceUrls: markdown.match(/https?:\/\/[^\s)>]+/gu) ?? [],
        conversationId,
      });
    },
  ),
  defineRelayCellTool(
    "prospects.list",
    "workspace.read",
    async ({ client }) => ({ prospects: await client.listProspects() }),
  ),
  defineRelayCellTool(
    "prospects.save",
    "workspace.write",
    async ({ client }, input) => await client.saveProspect(input),
  ),
  defineRelayCellTool("files.list", "workspace.read", async ({ client }) => ({
    files: await client.listWorkspaceFiles(),
  })),
  defineRelayCellTool(
    "files.write",
    "workspace.write",
    async ({ client, conversationId }, input) =>
      await client.saveWorkspaceFile({
        id: optionalString(input, "id"),
        path: optionalString(input, "path") ?? `/documents/${randomUUID()}.md`,
        title: requiredString(input, "name"),
        mimeType: input.kind === "email" ? "message/rfc822" : "text/markdown",
        content: requiredString(input, "content"),
        conversationId,
        expectedVersion: parseJsonNumber(input.expectedVersionId),
      }),
  ),
];
