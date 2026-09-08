import type {
  AuthenticatedIdentity,
  WorkspaceId,
} from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import {
  withTrustedAccountIdentity,
  withTrustedContext,
  withTrustedIdentity,
} from "./internal-context";
import { removeWorkspaceOrganization } from "./organization-tenancy";
import { authorizeWorkspace } from "./workspace-authorization";
import { accountStub, workspaceStub } from "./workspace-stubs";

export async function deleteManagedWorkspace(
  env: Env,
  identity: AuthenticatedIdentity,
  workspaceId: WorkspaceId,
  requestId: string,
) {
  if (identity.kind !== "user") {
    throw new AuthorizationError("A user identity is required.");
  }
  const principal = await authorizeWorkspace(env, {
    identity,
    requestId,
    workspaceId,
  });
  if (principal.kind !== "user" || principal.role !== "owner") {
    throw new AuthorizationError("Only a workspace owner can delete it.");
  }
  const workspace = workspaceStub(env, workspaceId);
  const planResponse = await workspace.fetch(
    withTrustedIdentity(
      { identity, requestId, workspaceId },
      {
        method: "POST",
        headers: { "x-chief-internal-operation": "deletion-plan" },
      },
    ),
  );
  if (!planResponse.ok) return planResponse;
  const plan = await planResponse.json<{
    conversationIds: string[];
    agentIds: string[];
  }>();
  const trustedDelete = (url: string, conversationId?: string) =>
    withTrustedContext(
      new Request(url, {
        method: "POST",
        headers: { "x-chief-internal-operation": "delete-all" },
      }),
      { principal, requestId, workspaceId, conversationId },
    );
  await Promise.all([
    ...plan.conversationIds.map((conversationId) =>
      env.CONVERSATIONS.get(
        env.CONVERSATIONS.idFromName(`${workspaceId}:${conversationId}`),
      ).fetch(trustedDelete("https://conversation.internal", conversationId)),
    ),
    ...plan.agentIds.map((agentId) =>
      env.AGENTS.get(env.AGENTS.idFromName(`${workspaceId}:${agentId}`)).fetch(
        trustedDelete("https://agent.internal"),
      ),
    ),
    deleteWorkspaceArtifacts(env.ARTIFACTS, workspaceId),
  ]);
  const directoryResponse = await accountStub(env, identity.userId).fetch(
    withTrustedAccountIdentity(identity, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chief-internal-operation": "remove-workspace",
      },
      body: JSON.stringify({ workspaceId }),
    }),
  );
  if (!directoryResponse.ok) return directoryResponse;
  const workspaceResponse = await workspace.fetch(
    withTrustedIdentity(
      { identity, requestId, workspaceId },
      {
        method: "POST",
        headers: { "x-chief-internal-operation": "delete-owned" },
      },
    ),
  );
  if (!workspaceResponse.ok) return workspaceResponse;
  await removeWorkspaceOrganization(env, workspaceId);
  return workspaceResponse;
}

export async function deleteWorkspaceArtifacts(
  bucket: R2Bucket,
  workspaceId: string,
) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `${workspaceId}/`, cursor });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((object) => object.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function deleteAgentArtifacts(
  bucket: R2Bucket,
  workspaceId: string,
  agentId: string,
) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: `${workspaceId}/agents/${agentId}/`,
      cursor,
    });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((object) => object.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
