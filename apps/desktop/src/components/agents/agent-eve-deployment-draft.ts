import { z } from "zod";

import {
  eveAgentProvisioningProgressSchema,
  eveAgentProvisioningResultSchema,
  parseJsonValue,
} from "@chief/relay-contracts";

export interface EveDeploymentDraft {
  model: string;
  projectId: string;
  projectMode: "" | "new" | "existing";
  projectNameOverride: string | null;
  teamId: string;
}

const schema = z
  .object({
    model: z.string(),
    projectId: z.string(),
    projectMode: z.enum(["", "new", "existing"]),
    projectNameOverride: z.string().nullable(),
    projectSuffix: z.string().optional(),
    teamId: z.string(),
  })
  .strict();

const provisioningSchema = z
  .object({
    open: z.boolean(),
    phase: z.enum([
      "validating",
      "uploading",
      "deploying",
      "configuring",
      "redeploying",
      "waiting",
      "checking",
      "verifying",
    ]),
    progress: eveAgentProvisioningProgressSchema.nullable(),
    error: z.string().nullable(),
    result: eveAgentProvisioningResultSchema.nullable(),
  })
  .strict();

export type EveProvisioningDraft = z.infer<typeof provisioningSchema>;

const draftKey = (agentId: string) => `chief:eve-deployment:${agentId}`;
const provisioningKey = (agentId: string) =>
  `chief:eve-provisioning:${agentId}`;

export function hasEveDeploymentDraft(agentId: string) {
  return readEveDeploymentDraft(agentId) !== null;
}

export function clearEveDeploymentDraft(agentId: string) {
  window.localStorage.removeItem(draftKey(agentId));
  window.sessionStorage.removeItem(draftKey(agentId));
  window.sessionStorage.removeItem(provisioningKey(agentId));
}

export function readEveDeploymentDraft(
  agentId: string,
): EveDeploymentDraft | null {
  try {
    const stored =
      window.localStorage.getItem(draftKey(agentId)) ??
      window.sessionStorage.getItem(draftKey(agentId));
    const parsed = schema.safeParse(
      parseJsonValue(JSON.parse(stored ?? "null")),
    );
    if (!parsed.success) return null;
    return {
      model: parsed.data.model,
      projectId: parsed.data.projectId,
      projectMode: parsed.data.projectMode,
      projectNameOverride: parsed.data.projectNameOverride,
      teamId: parsed.data.teamId,
    };
  } catch {
    return null;
  }
}

export function writeEveDeploymentDraft(
  agentId: string,
  draft: EveDeploymentDraft,
) {
  window.localStorage.setItem(draftKey(agentId), JSON.stringify(draft));
}

export function readEveProvisioningDraft(
  agentId: string,
): EveProvisioningDraft | null {
  try {
    const parsed = provisioningSchema.safeParse(
      parseJsonValue(
        JSON.parse(
          window.sessionStorage.getItem(provisioningKey(agentId)) ?? "null",
        ),
      ),
    );
    if (!parsed.success) return null;
    return {
      open: parsed.data.open,
      phase: parsed.data.phase,
      progress: parsed.data.progress,
      error: parsed.data.error,
      result: parsed.data.result,
    };
  } catch {
    return null;
  }
}

export function writeEveProvisioningDraft(
  agentId: string,
  draft: EveProvisioningDraft,
) {
  window.sessionStorage.setItem(
    provisioningKey(agentId),
    JSON.stringify(draft),
  );
}

export function projectSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}
