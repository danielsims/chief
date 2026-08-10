import type {
  AgentDeploymentPhase,
  AgentDeploymentTarget,
  InputRequest,
} from "@chief/agent-runtime/types";

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
    metadata.onboarding && typeof metadata.onboarding === "object"
      ? (metadata.onboarding as Record<string, unknown>)
      : {};
  const agentDeployments =
    onboarding.agentDeployments &&
    typeof onboarding.agentDeployments === "object"
      ? (onboarding.agentDeployments as Record<string, unknown>)
      : {};
  const raw =
    agentDeployments[agentId] ??
    (agentId === "cmo" ? onboarding.chiefDeployment : undefined);
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.url !== "string" || !value.url) return null;
  return {
    url: value.url,
    target: value.target === "convex" ? "convex" : "vercel",
    deployedAt:
      typeof value.deployedAt === "number" ? value.deployedAt : undefined,
    model: typeof value.model === "string" ? value.model : undefined,
  };
}

export function projectSlug(workspaceId: string | null, agentId: string) {
  const suffix = workspaceId?.replace(/[^a-z0-9]/gi, "").slice(-8) ?? "local";
  const agent = agentId.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  return `chief-${agent === "cmo" ? "" : `${agent}-`}${suffix}`.toLowerCase();
}

export function phaseIndex(phase: AgentDeploymentPhase | undefined) {
  return PHASES.findIndex((item) => item.phase === phase);
}
