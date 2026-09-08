import type {
  AuthenticatedIdentity,
  CreateWorkspaceCommand,
  Principal,
  ProvisionWorkspaceCommand,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  commandIdSchema,
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
import {
  registerWorkspaceOrganization,
  registerWorkspaceOrganizationMember,
  removeWorkspaceOrganization,
  requireWorkspaceOrganizationMember,
} from "./organization-tenancy";
import { recordProductEvents } from "./product-events";
import { enqueueOnboarding } from "./workspace-onboarding-enqueue";
import { readWorkspaceSettings } from "./workspace-settings";
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
  created: boolean;
}

export async function createManagedWorkspace(
  env: Env,
  identity: AuthenticatedIdentity,
  provision: ProvisionWorkspaceCommand,
  context?: Pick<ExecutionContext, "waitUntil">,
) {
  if (identity.kind !== "user") {
    throw new AuthorizationError("A user identity is required.");
  }
  const command = provision.workspace;
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
  let response: Response;
  try {
    await registerWorkspaceOrganization(env, {
      identity,
      name: command.name,
      website: command.website,
      workspaceId: entry.workspaceId,
    });
    response = await workspaceStub(env, entry.workspaceId).fetch(
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
          body: JSON.stringify(provision),
        },
      ),
    );
    if (!response.ok) {
      if (entry.created) await rollbackProvisioning(env, identity, entry);
      return response;
    }
  } catch (error) {
    if (entry.created) await rollbackProvisioning(env, identity, entry);
    throw error;
  }
  recordProductEvents(env, ["signup", "workspace-created"], {
    kind: "user",
    userId: identity.userId,
    pubkey: identity.pubkey,
    workspaceId: entry.workspaceId,
    role: "owner",
  });
  if (command.agentRuntime === "relay-cell") {
    const onboarding = enqueueOnboarding(
      env,
      identity,
      { ...entry, command },
      false,
    );
    if (context) {
      context.waitUntil(
        onboarding.catch((error: unknown) => {
          console.error(
            "[Workspace] Initial onboarding enqueue failed:",
            error,
          );
        }),
      );
    } else {
      await onboarding;
    }
  }
  return response;
}

async function rollbackProvisioning(
  env: Env,
  identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  entry: WorkspaceDirectoryEntry,
) {
  const workspace = workspaceStub(env, entry.workspaceId);
  await Promise.allSettled([
    accountStub(env, identity.userId).fetch(
      withTrustedAccountIdentity(identity, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "remove-workspace",
        },
        body: JSON.stringify({ workspaceId: entry.workspaceId }),
      }),
    ),
    workspace.fetch(
      withTrustedIdentity(
        {
          identity,
          requestId: crypto.randomUUID(),
          workspaceId: entry.workspaceId,
        },
        {
          method: "POST",
          headers: { "x-chief-internal-operation": "delete-owned" },
        },
      ),
    ),
    removeWorkspaceOrganization(env, entry.workspaceId),
  ]);
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
  if (env.ACCOUNT_IDENTITY_MODE === "chief-account") {
    const settings = await readWorkspaceSettings(env, entry.workspaceId);
    if (settings) Object.assign(snapshot, settings);
  }
  snapshot.runtime =
    entry.command?.agentRuntime === "relay-cell" ? entry.command.runtime : null;
  if (
    snapshot.onboardingComplete === false &&
    entry.command?.agentRuntime === "relay-cell"
  ) {
    const repair = enqueueOnboarding(
      env,
      identity,
      { ...entry, command: entry.command },
      true,
    );
    if (context) {
      context.waitUntil(
        repair.catch((error: unknown) => {
          console.error("[Workspace] Onboarding repair failed:", error);
        }),
      );
    } else {
      await repair;
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
