import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import {
  agentConfigSchema,
  agentJobSchema,
  eveWorkspaceKickoffResultSchema,
} from "@chief/relay-contracts";

import { publishAgentMessage } from "./agent-message-publisher";
import { hostedPrincipal } from "./agent-object-values";
import { publishOnboardingResult } from "./agent-onboarding";
import { deterministicUuid } from "./external-agent-channel-security";
import { json } from "./http";
import { readTrustedContext } from "./internal-context";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";
import { WORKSPACE_ONBOARDING_OPENING_MESSAGE } from "./workspace-onboarding-job";
import { WorkspaceSecretStore } from "./workspace-secret-store";

const GATEWAY_SECRET = "vercel-ai-gateway";
const DEPLOYMENT_SECRET = "vercel-deployment";

export async function prepareEveWorkspaceOnboarding(input: {
  env: Env;
  storage: DurableObjectStorage;
  channels: WorkspaceChannelStore;
  workspaceId: string;
  snapshot: WorkspaceSnapshot;
}) {
  if (input.snapshot.onboardingComplete) return;
  await enableHostedSpecialists(input);
}

export async function startEveWorkspaceKickoffFromRequest(
  env: Env,
  storage: DurableObjectStorage,
  request: Request,
) {
  const context = readTrustedContext(request);
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requirePrincipalMember(context.principal);
  const workspace = channels.requireWorkspace(context.workspaceId);
  if (!workspace.snapshot_json) {
    return json(eveWorkspaceKickoffResultSchema.parse({ started: false }));
  }
  const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
  const started = await startEveWorkspaceKickoff({
    env,
    storage,
    channels,
    workspaceId: context.workspaceId,
    createdAt: String(workspace.created_at),
    createdByUserId: String(workspace.created_by_user_id),
    snapshot,
  });
  return json(eveWorkspaceKickoffResultSchema.parse({ started }));
}

export async function startEveWorkspaceKickoff(input: {
  env: Env;
  storage: DurableObjectStorage;
  channels: WorkspaceChannelStore;
  workspaceId: string;
  createdAt: string;
  createdByUserId: string;
  snapshot: WorkspaceSnapshot;
  selectedApps?: readonly string[];
}) {
  if (input.snapshot.onboardingComplete) return false;
  const chief = input.snapshot.agents.find((agent) => agent.id === "chief");
  if (
    chief?.runtime.kind !== "external-channel" ||
    chief.runtime.connectionStatus !== "connected"
  ) {
    return false;
  }
  await enableHostedSpecialists(input);
  const occurredAt = new Date(input.createdAt).toISOString();
  const jobId = await deterministicUuid(
    `${input.workspaceId}:eve-onboarding-job`,
  );
  const job = agentJobSchema.parse({
    id: jobId,
    workspaceId: input.workspaceId,
    agentId: "chief",
    kind: "workspace.onboarding",
    payload: {
      workflowId: jobId,
      name: input.snapshot.name,
      website: input.snapshot.website,
      selectedApps: input.selectedApps ?? input.snapshot.selectedApps,
      ownerUserId: input.createdByUserId,
    },
    status: "completed",
    attempt: 0,
    lastError: null,
    availableAt: occurredAt,
    leaseExpiresAt: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
  await publishOnboardingResult(
    input.env,
    job,
    hostedPrincipal(job),
    { openingMessage: WORKSPACE_ONBOARDING_OPENING_MESSAGE },
    (onboardingJob, message, commandId, actorPubkey) =>
      publishAgentMessage(
        input.env,
        onboardingJob,
        message,
        commandId,
        actorPubkey,
      ),
  );
  return true;
}

async function enableHostedSpecialists(input: {
  env: Env;
  storage: DurableObjectStorage;
  channels: WorkspaceChannelStore;
  workspaceId: string;
}) {
  const secrets = new WorkspaceSecretStore(
    input.storage,
    input.env.RELAY_SECRET_KEY,
  );
  if (!(await secrets.get(input.workspaceId, GATEWAY_SECRET))) {
    const token = await secrets.get(input.workspaceId, DEPLOYMENT_SECRET);
    if (token) await secrets.set(input.workspaceId, GATEWAY_SECRET, token);
  }
  const now = new Date().toISOString();
  for (const agentId of input.channels.workspaceAgentIds()) {
    if (agentId === "chief") continue;
    const config = input.channels.agentConfiguration(agentId);
    const inference =
      config.inference.provider === "vercel-ai-gateway" ||
      config.inference.provider === "opencode"
        ? { ...config.inference, secretRef: GATEWAY_SECRET }
        : config.inference;
    input.storage.sql.exec(
      `UPDATE agent_configs SET config_json = ?, updated_at = ? WHERE agent_id = ?`,
      JSON.stringify(
        agentConfigSchema.parse({
          ...config,
          enabled: true,
          deploymentTarget: "cloud",
          inference,
        }),
      ),
      now,
      agentId,
    );
  }
}
