import { randomUUID } from "node:crypto";

import {
  brandProfileSaveSchema,
  prospectSaveSchema,
} from "@chief/relay-contracts";

import { optionalString, requiredString } from "../input";
import { defineHostedAgentTool } from "../tool";
import { workspaceOperation } from "./channels";

export const hostedWorkspaceTools = [
  defineHostedAgentTool(
    "brandProfile.status",
    async ({ env, job, principal }) =>
      await workspaceOperation(env, job, principal, "data-brand-get"),
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
  ),
  defineHostedAgentTool(
    "prospects.list",
    async ({ env, job, principal }) =>
      await workspaceOperation(env, job, principal, "data-prospects-list"),
  ),
  defineHostedAgentTool(
    "prospects.save",
    async ({ env, job, principal }, input) =>
      await workspaceOperation(env, job, principal, "data-prospect-save", {
        body: prospectSaveSchema.parse({
          id: optionalString(input, "id") ?? randomUUID(),
          name: requiredString(input, "name"),
          company: optionalString(input, "company") ?? null,
          source: requiredString(input, "source"),
          sourceUrl: requiredString(input, "sourceUrl"),
          summary: requiredString(input, "summary"),
          evidence: requiredString(input, "evidence"),
          outreachAngle: requiredString(input, "outreachAngle"),
          relevance: input.relevance,
          status: input.status === "researching" ? "reviewing" : input.status,
        }),
      }),
  ),
];
