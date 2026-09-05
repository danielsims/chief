import { createHash, randomUUID } from "node:crypto";

import { workspaceScheduleInputSchema } from "@chief/relay-contracts";

import { optionalString, requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

export const relayCellWorkspaceTools = [
  defineRelayCellTool(
    "recurringWork.list",
    "workspace.read",
    async ({ client }) => ({ schedules: await client.schedules.list() }),
  ),
  defineRelayCellTool(
    "recurringWork.propose",
    "workspace.write",
    async ({ client, conversationId }, input) =>
      await client.schedules.save(
        workspaceScheduleInputSchema.parse({
          ...input,
          id:
            optionalString(input, "id") ??
            `schedule-${createHash("sha256")
              .update(`${conversationId}:${requiredString(input, "title")}`)
              .digest("hex")
              .slice(0, 32)}`,
          conversationId:
            optionalString(input, "conversationId") ?? conversationId,
          onceAt: input.onceAt,
        }),
      ),
  ),
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
    "files.read",
    "workspace.read",
    async ({ client }, input) => {
      const file = (await client.listWorkspaceFiles()).find(
        (candidate) => candidate.id === requiredString(input, "fileId"),
      );
      if (!file) throw new Error("File not found.");
      return { file };
    },
  ),
  defineRelayCellTool(
    "files.write",
    "messages.send",
    async ({ client, conversationId }, input) => {
      const existing = input.id
        ? (await client.listWorkspaceFiles()).find(
            (file) => file.id === input.id,
          )
        : undefined;
      return await client.saveWorkspaceFile({
        id: optionalString(input, "id"),
        path:
          optionalString(input, "path") ??
          existing?.path ??
          `artifacts/${randomUUID()}.${input.format === "html" ? "html" : input.format === "csv" ? "csv" : input.format === "json" ? "json" : "md"}`,
        title: requiredString(input, "name"),
        mimeType:
          input.kind === "email"
            ? "message/rfc822"
            : input.format === "html"
              ? "text/html"
              : input.format === "csv"
                ? "text/csv"
                : input.format === "json"
                  ? "application/json"
                  : "text/markdown",
        content: requiredString(input, "content"),
        conversationId:
          optionalString(input, "conversationId") ??
          existing?.conversationId ??
          conversationId,
        expectedVersion: input.expectedVersionId
          ? Number(requiredString(input, "expectedVersionId"))
          : undefined,
      });
    },
  ),
];
