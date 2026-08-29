import type {
  AuthenticatedIdentity,
  CreateWorkspaceCommand,
  UserPrincipal,
  WorkspaceId,
} from "@chief/relay-contracts";
import { hexPubkeySchema } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import { workspaceOnboardingInstruction } from "./workspace-onboarding-job";

interface OnboardingWorkspace {
  workspaceId: WorkspaceId;
  createdAt: string;
  command: CreateWorkspaceCommand;
}

export async function enqueueOnboarding(
  env: Env,
  identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  entry: OnboardingWorkspace,
  repairTerminal: boolean,
) {
  const principal: UserPrincipal = {
    kind: "user",
    userId: identity.userId,
    pubkey: hexPubkeySchema.parse(identity.pubkey),
    workspaceId: entry.workspaceId,
    role: "owner",
  };
  const occurredAt = entry.createdAt;
  const jobId = crypto.randomUUID();
  const operation = repairTerminal ? "ensure" : "enqueue";
  const request = new Request(`https://agent.internal/${operation}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chief-workflow-id": jobId,
    },
    body: JSON.stringify({
      commandId: entry.command.commandId,
      protocolVersion: 1,
      occurredAt,
      payload: {
        id: jobId,
        agentId: "chief",
        kind: "workspace.onboarding",
        payload: {
          workflowId: jobId,
          name: entry.command.name,
          website: entry.command.website,
          runtime: entry.command.runtime,
          inferenceProvider: entry.command.inferenceProvider,
          inferenceModel: entry.command.inferenceModel,
          selectedApps: entry.command.selectedApps,
          instruction: workspaceOnboardingInstruction({
            name: entry.command.name,
            website: entry.command.website,
            selectedApps: entry.command.selectedApps,
          }),
        },
        availableAt: occurredAt,
      },
    }),
  });
  const stub = env.AGENTS.get(
    env.AGENTS.idFromName(`${entry.workspaceId}:chief`),
  );
  const response = await stub.fetch(
    withTrustedContext(request, {
      principal,
      requestId: entry.command.commandId,
      workspaceId: entry.workspaceId,
    }),
  );
  const enqueued = response.ok;
  await releaseInternalResponse(response);
  if (!enqueued) {
    throw new HttpError(
      502,
      "agent_enqueue_failed",
      "Chief's initial workspace setup could not be queued.",
    );
  }
}
