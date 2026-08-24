import type {
  AgentDeploymentPhase,
  AgentDeploymentTarget,
  InputRequest,
} from "@chief/agent-runtime/types";
import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

import type { AuthOrganization } from "../../lib/auth/better-auth-client";
import { parseOrganizationMetadata } from "../../lib/auth/better-auth-client";

interface PersistedDeployment {
  url: string;
  target: AgentDeploymentTarget;
  deployedAt?: number;
  model?: string;
}

export const PHASES: { phase: AgentDeploymentPhase; label: string }[] = [
  { phase: "preparing", label: "Prepare" },
  { phase: "authenticating", label: "Authenticate" },
  { phase: "linking", label: "Link project" },
  { phase: "configuring", label: "Configure" },
  { phase: "building", label: "Build" },
  { phase: "deploying", label: "Deploy" },
  { phase: "verifying", label: "Verify" },
];
export const DEPLOYED_SLACK_KEYS = ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"];
export const DEPLOYED_SLACK_REQUEST: InputRequest = {
  id: "deployed-slack-credentials",
  title: "Slack deployment credentials",
  fields: [
    {
      key: "botToken",
      label: "Bot token",
      type: "secret",
      save: { envKey: "SLACK_BOT_TOKEN" },
    },
    {
      key: "signingSecret",
      label: "Signing secret",
      type: "secret",
      save: { envKey: "SLACK_SIGNING_SECRET" },
    },
  ],
};

export function persistedDeployment(
  org: AuthOrganization | null,
  agentId: string,
): PersistedDeployment | null {
  if (!org) return null;
  const metadata = parseOrganizationMetadata(org);
  const onboarding =
    metadata.onboarding && isJsonObject(metadata.onboarding)
      ? (metadata.onboarding as Record<string, unknown>)
      : {};
  const agentDeployments =
    onboarding.agentDeployments && isJsonObject(onboarding.agentDeployments)
      ? (onboarding.agentDeployments as Record<string, unknown>)
      : {};
  const raw =
    agentDeployments[agentId] ??
    (agentId === "chief" ? agentDeployments.cmo : undefined) ??
    (agentId === "chief" ? onboarding.chiefDeployment : undefined);
  if (!raw || !isJsonObject(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!isJsonString(value.url) || !value.url) return null;
  return {
    url: value.url,
    target: "vercel",
    deployedAt: isJsonNumber(value.deployedAt) ? value.deployedAt : undefined,
    model: isJsonString(value.model) ? value.model : undefined,
  };
}

export function projectSlug(workspaceId: string | null, agentId: string) {
  const suffix = workspaceId?.replace(/[^a-z0-9]/gi, "").slice(-8) ?? "local";
  const agent = agentId.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  return `chief-${agent === "chief" ? "" : `${agent}-`}${suffix}`.toLowerCase();
}

export function phaseIndex(phase: AgentDeploymentPhase | undefined) {
  return PHASES.findIndex((item) => item.phase === phase);
}
