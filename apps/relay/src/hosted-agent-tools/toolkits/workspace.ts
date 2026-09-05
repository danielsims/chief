import {
  brandProfileSaveSchema,
  prospectSaveSchema,
  workspaceScheduleInputSchema,
  workspaceFileSaveSchema,
  workspaceFilesResultSchema,
} from "@chief/relay-contracts";

import { optionalString, requiredString } from "../input";
import { defineHostedAgentTool } from "../tool";
import { deterministicUuid, workspaceOperation } from "./channels";

export const hostedWorkspaceTools = [
  defineHostedAgentTool(
    "recurringWork.list",
    async ({ env, job, principal }) =>
      await workspaceOperation(env, job, principal, "schedules-list"),
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "recurringWork.propose",
    async ({ env, job, principal }, input) =>
      await workspaceOperation(env, job, principal, "schedules-save", {
        body: workspaceScheduleInputSchema.parse({
          ...input,
          id:
            optionalString(input, "id") ??
            (await deterministicUuid(
              `${job.id}:schedule:${requiredString(input, "title")}`,
            )),
          conversationId:
            optionalString(input, "conversationId") ??
            requiredString(job.payload, "conversationId"),
          onceAt: input.onceAt,
        }),
      }),
    { effect: "idempotent" },
  ),
  defineHostedAgentTool(
    "files.list",
    async ({ env, job, principal }) =>
      workspaceOperation(env, job, principal, "data-files-list"),
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "files.read",
    async ({ env, job, principal }, input) => {
      const { files } = workspaceFilesResultSchema.parse(
        await workspaceOperation(env, job, principal, "data-files-list"),
      );
      const file = files.find(
        (candidate) => candidate.id === requiredString(input, "fileId"),
      );
      if (!file) throw new Error("File not found.");
      return { file };
    },
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "files.write",
    async ({ env, job, principal }, input) =>
      workspaceOperation(env, job, principal, "data-file-save", {
        body: workspaceFileSaveSchema.parse({
          id: optionalString(input, "id"),
          path:
            optionalString(input, "path") ??
            `documents/${crypto.randomUUID()}.md`,
          title: requiredString(input, "name"),
          content: requiredString(input, "content"),
          mimeType: input.kind === "email" ? "message/rfc822" : "text/markdown",
          conversationId: requiredString(job.payload, "conversationId"),
          expectedVersion: input.expectedVersionId
            ? Number(requiredString(input, "expectedVersionId"))
            : undefined,
        }),
      }),
    { effect: "non_replayable" },
  ),

  defineHostedAgentTool(
    "brandProfile.status",
    async ({ env, job, principal }) =>
      await workspaceOperation(env, job, principal, "data-brand-get"),
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "brandProfile.save",
    async ({ env, job, principal }, input) =>
      await workspaceOperation(env, job, principal, "data-brand-save", {
        body: brandProfileSaveSchema.parse({
          markdown: requiredString(input, "markdown"),
          sourceUrls: input.sourceUrls,
          conversationId: requiredString(job.payload, "conversationId"),
        }),
      }),
    { effect: "idempotent" },
  ),
  defineHostedAgentTool(
    "prospects.list",
    async ({ env, job, principal }) =>
      await workspaceOperation(env, job, principal, "data-prospects-list"),
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "prospects.save",
    async ({ env, job, principal }, input) => {
      const sourceUrl = requiredString(input, "sourceUrl");
      return await workspaceOperation(
        env,
        job,
        principal,
        "data-prospect-save",
        {
          body: prospectSaveSchema.parse({
            id:
              optionalString(input, "id") ??
              (await deterministicUuid(`${job.id}:prospect:${sourceUrl}`)),
            name: requiredString(input, "name"),
            company: optionalString(input, "company") ?? null,
            source: requiredString(input, "source"),
            sourceUrl,
            summary: requiredString(input, "summary"),
            evidence: requiredString(input, "evidence"),
            outreachAngle: requiredString(input, "outreachAngle"),
            relevance: input.relevance,
            status: input.status === "researching" ? "reviewing" : input.status,
          }),
        },
      );
    },
    { effect: "idempotent" },
  ),
];
