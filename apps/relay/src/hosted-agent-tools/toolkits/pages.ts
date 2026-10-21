import {
  pageMimeType,
  workspaceFileSaveSchema,
  workspaceFilesResultSchema,
} from "@chief/relay-contracts";

import { optionalString, requiredString } from "../input";
import { defineHostedAgentTool } from "../tool";
import { deterministicUuid, workspaceOperation } from "./channels";

export const hostedPageTools = [
  defineHostedAgentTool(
    "pages.save",
    async ({ env, job, principal }, input) => {
      const name = requiredString(input, "name");
      const { files } = workspaceFilesResultSchema.parse(
        await workspaceOperation(env, job, principal, "data-files-list"),
      );
      const requestedId = optionalString(input, "id");
      const existing = files.find((file) => file.id === requestedId);
      const conversationId =
        existing?.conversationId ??
        optionalString(input, "channelId") ??
        requiredString(job.payload, "conversationId");
      // A retried turn saves the same new page rather than a second one.
      const id =
        existing?.id ??
        (await deterministicUuid(`${job.id}:page:${conversationId}:${name}`));
      const saved = files.find((file) => file.id === id);
      // The relay checks the page itself, whoever saves it.
      return workspaceOperation(env, job, principal, "data-file-save", {
        body: workspaceFileSaveSchema.parse({
          id,
          path: saved?.path ?? `artifacts/${id}.page.json`,
          title: name,
          mimeType: pageMimeType,
          content: JSON.stringify(input.page ?? {}),
          conversationId,
          ...(saved ? { expectedVersion: saved.version } : undefined),
        }),
      });
    },
    { effect: "idempotent" },
  ),
];
