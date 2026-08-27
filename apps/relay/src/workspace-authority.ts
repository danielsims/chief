import type {
  AuthenticatedIdentity,
  CreateWorkspaceCommand,
  Principal,
  UserPrincipal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  commandIdSchema,
  hexPubkeySchema,
  organizationWorkspaceJoinResultSchema,
  parseJsonObject,
  workspaceInviteClaimResultSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import { HttpError, json } from "./http";
import {
  withTrustedAccountIdentity,
  withTrustedContext,
  withTrustedIdentity,
} from "./internal-context";
import { recordMetrics } from "./metrics";
import {
  registerWorkspaceOrganization,
  registerWorkspaceOrganizationMember,
  requireWorkspaceOrganizationMember,
} from "./organization-tenancy";
import { workspaceOnboardingInstruction } from "./workspace-onboarding-job";
import { accountStub, workspaceStub } from "./workspace-stubs";

export {
  authorizeConversation,
  authorizeWorkspace,
} from "./workspace-authorization";
export { deleteManagedWorkspace } from "./workspace-deletion";

interface WorkspaceDirectoryEntry {
  workspaceId: WorkspaceId;
  name: string;
  website: string;
  command: CreateWorkspaceCommand | null;
  createdAt: string;
}

export async function createManagedWorkspace(
  env: Env,
  identity: AuthenticatedIdentity,
  command: CreateWorkspaceCommand,
  context?: Pick<ExecutionContext, "waitUntil">,
) {
  if (identity.kind !== "user") {
    throw new AuthorizationError("A user identity is required.");
  }
  const directory = accountStub(env, identity.userId);
  const directoryResponse = await directory.fetch(
    withTrustedAccountIdentity(identity, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chief-internal-operation": "create-workspace",
      },
      body: JSON.stringify(command),
    }),
  );
  if (!directoryResponse.ok) return directoryResponse;
  const entry: WorkspaceDirectoryEntry = await directoryResponse.json();
  await registerWorkspaceOrganization(env, {
    identity,
    name: command.name,
    website: command.website,
    workspaceId: entry.workspaceId,
  });
  const response = await workspaceStub(env, entry.workspaceId).fetch(
    withTrustedIdentity(
      {
        identity,
        requestId: command.commandId,
        workspaceId: entry.workspaceId,
      },
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "create-managed",
        },
        body: JSON.stringify(command),
      },
    ),
  );
  if (!response.ok) return response;
  recordMetrics(env, ["signup", "workspace-created"], {
    kind: "user",
    userId: identity.userId,
    pubkey: identity.pubkey,
    workspaceId: entry.workspaceId,
    role: "owner",
  });
  const onboarding = enqueueOnboarding(
    env,
    identity,
    { ...entry, command },
    false,
  );
  if (context) {
    context.waitUntil(
      onboarding.catch((error: unknown) => {
        console.error("[Workspace] Initial onboarding enqueue failed:", error);
      }),
    );
  } else {
    await onboarding;
  }
  return response;
}

export async function activeManagedWorkspace(
  env: Env,
  identity: AuthenticatedIdentity,
  context?: Pick<ExecutionContext, "waitUntil">,
) {
  if (identity.kind !== "user") {
    throw new AuthorizationError("A user identity is required.");
  }
  const directoryResponse = await accountStub(env, identity.userId).fetch(
    withTrustedAccountIdentity(identity, {
      method: "POST",
      headers: { "x-chief-internal-operation": "active-workspace" },
    }),
  );
  if (directoryResponse.status === 204) return directoryResponse;
  if (!directoryResponse.ok) return directoryResponse;
  const entry: WorkspaceDirectoryEntry = await directoryResponse.json();
  const response = await workspaceStub(env, entry.workspaceId).fetch(
    withTrustedIdentity(
      {
        identity,
        requestId: crypto.randomUUID(),
        workspaceId: entry.workspaceId,
      },
      {
        method: "POST",
        headers: { "x-chief-internal-operation": "snapshot" },
      },
    ),
  );
  if (!response.ok) return response;
  const snapshot = parseJsonObject(JSON.parse(await response.text()));
  if (!snapshot) {
    throw new HttpError(
      502,
      "invalid_workspace_snapshot",
      "The workspace returned an invalid snapshot.",
    );
  }
  snapshot.runtime = entry.command?.runtime ?? null;
  if (snapshot.onboardingComplete === false && entry.command) {
    // Unit-level authority calls retain deterministic repair coverage. Public
    // GET requests intentionally do not enqueue work: reads must return the
    // existing snapshot immediately, even when the agent authority is slow or
    // its Cloudflare allowance has been exhausted.
    if (!context) {
      await enqueueOnboarding(
        env,
        identity,
        { ...entry, command: entry.command },
        true,
      );
    }
  }
  // The body changed, so do not reuse the Durable Object response headers.
  // In particular, a stale Content-Length leaves native HTTP clients waiting
  // for bytes that will never arrive.
  return json(snapshot, { status: response.status });
}

export async function createWorkspaceInvite(
  env: Env,
  request: Request,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
  },
) {
  const body = await request.text();
  return workspaceStub(env, input.workspaceId).fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "content-type": request.headers.get("content-type") ?? "",
          "x-chief-internal-operation": "invite-create",
        },
        body,
      }),
      input,
    ),
  );
}

export async function previewWorkspaceInvite(
  env: Env,
  request: Request,
  workspaceId: WorkspaceId,
) {
  return workspaceStub(env, workspaceId).fetch(
    new Request("https://workspace.internal", {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") ?? "",
        "x-chief-internal-operation": "invite-preview",
      },
      body: await request.text(),
    }),
  );
}

export async function claimWorkspaceInvite(
  env: Env,
  request: Request,
  input: {
    identity: AuthenticatedIdentity;
    requestId: string;
    workspaceId: WorkspaceId;
  },
) {
  if (input.identity.kind !== "user") {
    throw new AuthorizationError("A user identity is required.");
  }
  const body = await request.text();
  const response = await workspaceStub(env, input.workspaceId).fetch(
    withTrustedIdentity(input, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") ?? "",
        "x-chief-internal-operation": "invite-claim",
      },
      body,
    }),
  );
  if (!response.ok) return response;
  const result = workspaceInviteClaimResultSchema.parse(
    await response.clone().json(),
  );
  await registerWorkspaceOrganizationMember(env, {
    identity: input.identity,
    workspaceId: result.workspaceId,
  });
  const operationId = commandIdSchema.parse(
    parseJsonObject(JSON.parse(body))?.commandId,
  );
  const directoryResponse = await accountStub(env, input.identity.userId).fetch(
    withTrustedAccountIdentity(input.identity, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chief-internal-operation": "join-workspace",
      },
      body: JSON.stringify({
        workspaceId: result.workspaceId,
        operationId,
        name: result.workspaceName,
        website: result.website,
        createdAt: new Date().toISOString(),
      }),
    }),
  );
  if (!directoryResponse.ok) return directoryResponse;
  return response;
}

export async function joinOrganizationWorkspace(
  env: Env,
  input: {
    identity: AuthenticatedIdentity;
    requestId: string;
    workspaceId: WorkspaceId;
  },
) {
  if (input.identity.kind !== "user") {
    throw new AuthorizationError("A user identity is required.");
  }
  await requireWorkspaceOrganizationMember(
    env,
    input.identity,
    input.workspaceId,
  );
  const response = await workspaceStub(env, input.workspaceId).fetch(
    withTrustedIdentity(input, {
      method: "POST",
      headers: { "x-chief-internal-operation": "organization-member-join" },
    }),
  );
  if (!response.ok) return response;
  const result = organizationWorkspaceJoinResultSchema.parse(
    await response.clone().json(),
  );
  const directoryResponse = await accountStub(env, input.identity.userId).fetch(
    withTrustedAccountIdentity(input.identity, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chief-internal-operation": "join-workspace",
      },
      body: JSON.stringify({
        workspaceId: result.workspaceId,
        operationId: crypto.randomUUID(),
        name: result.workspaceName,
        website: result.website,
        createdAt: new Date().toISOString(),
      }),
    }),
  );
  if (!directoryResponse.ok) return directoryResponse;
  return response;
}

export async function listManagedWorkspaces(
  env: Env,
  identity: AuthenticatedIdentity,
) {
  if (identity.kind !== "user") {
    throw new AuthorizationError("A user identity is required.");
  }
  return accountStub(env, identity.userId).fetch(
    withTrustedAccountIdentity(identity, {
      method: "POST",
      headers: { "x-chief-internal-operation": "list-workspaces" },
    }),
  );
}

export async function switchManagedWorkspace(
  env: Env,
  identity: AuthenticatedIdentity,
  workspaceId: WorkspaceId,
) {
  if (identity.kind !== "user") {
    throw new AuthorizationError("A user identity is required.");
  }
  await requireWorkspaceOrganizationMember(env, identity, workspaceId);
  return accountStub(env, identity.userId).fetch(
    withTrustedAccountIdentity(identity, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chief-internal-operation": "switch-workspace",
      },
      body: JSON.stringify({ workspaceId }),
    }),
  );
}

export async function claimWorkspace(
  env: Env,
  request: Request,
  input: {
    identity: AuthenticatedIdentity;
    requestId: string;
    workspaceId: WorkspaceId;
  },
) {
  const body = await request.text();
  return workspaceStub(env, input.workspaceId).fetch(
    withTrustedIdentity(input, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") ?? "",
        "x-chief-internal-operation": "claim",
      },
      body,
    }),
  );
}

export async function routeWorkspaceLogs(
  env: Env,
  request: Request,
  input: {
    identity: AuthenticatedIdentity;
    requestId: string;
    workspaceId: WorkspaceId;
  },
) {
  const operation = request.method === "POST" ? "record-logs" : "list-logs";
  const body = request.method === "POST" ? await request.text() : undefined;
  const internalUrl = new URL("https://workspace.internal");
  internalUrl.search = new URL(request.url).search;
  const trusted = withTrustedIdentity(input, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") ?? "",
      "x-chief-internal-operation": operation,
    },
    body,
  });
  return workspaceStub(env, input.workspaceId).fetch(
    new Request(internalUrl, trusted),
  );
}

/** Forwards a channels RPC to the workspace DO using the resolved principal
 * context so registered agents can create channels and add members during
 * kick-off (matching how agent jobs are routed). */
export async function routeChannelOperation(
  env: Env,
  request: Request,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    operation: string;
  },
) {
  const body = await request.text();
  const internalUrl = new URL("https://workspace.internal");
  internalUrl.search = new URL(request.url).search;
  const trusted = withTrustedContext(
    new Request(internalUrl, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") ?? "",
        "x-chief-internal-operation": input.operation,
      },
      body,
    }),
    {
      principal: input.principal,
      requestId: input.requestId,
      workspaceId: input.workspaceId,
    },
  );
  return workspaceStub(env, input.workspaceId).fetch(trusted);
}

async function enqueueOnboarding(
  env: Env,
  identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  entry: WorkspaceDirectoryEntry & { command: CreateWorkspaceCommand },
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
  if (!response.ok) {
    throw new HttpError(
      502,
      "agent_enqueue_failed",
      "Chief's initial workspace setup could not be queued.",
    );
  }
}
