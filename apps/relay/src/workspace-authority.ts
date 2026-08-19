import type {
  AuthenticatedIdentity,
  CreateWorkspaceCommand,
  Principal,
  UserPrincipal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  agentIdSchema,
  appendMessageCommandSchema,
  conversationIdSchema,
  workspaceAuthorizationResultSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import { HttpError } from "./http";
import {
  withTrustedAccountIdentity,
  withTrustedContext,
  withTrustedIdentity,
} from "./internal-context";

interface WorkspaceDirectoryEntry {
  workspaceId: WorkspaceId;
  command: CreateWorkspaceCommand;
  createdAt: string;
}

export async function createManagedWorkspace(
  env: Env,
  identity: AuthenticatedIdentity,
  command: CreateWorkspaceCommand,
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
  const entry: WorkspaceDirectoryEntry = await directoryResponse.json();
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
        body: JSON.stringify(entry.command),
      },
    ),
  );
  if (!response.ok) return response;
  await enqueueOnboarding(env, identity, entry);
  return response;
}

export async function activeManagedWorkspace(
  env: Env,
  identity: AuthenticatedIdentity,
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
  const entry: WorkspaceDirectoryEntry = await directoryResponse.json();
  return workspaceStub(env, entry.workspaceId).fetch(
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
}

export async function authorizeWorkspace(
  env: Env,
  input: {
    identity: AuthenticatedIdentity;
    requestId: string;
    workspaceId: WorkspaceId;
  },
): Promise<Principal> {
  const response = await workspaceStub(env, input.workspaceId).fetch(
    withTrustedIdentity(input, {
      method: "POST",
      headers: { "x-chief-internal-operation": "authorize" },
    }),
  );
  if (!response.ok) {
    throw new AuthorizationError(
      "The workspace is not available to this identity.",
    );
  }
  return workspaceAuthorizationResultSchema.parse(await response.json())
    .principal;
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

export async function routeAgentJob(
  env: Env,
  request: Request,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    agentId: string;
    operation: "claim" | "complete";
  },
) {
  if (input.principal.kind !== "user" || input.principal.role !== "owner") {
    throw new AuthorizationError(
      "Only a workspace owner can run an agent on this device.",
    );
  }
  const body = await request.text();
  const stub = env.AGENTS.get(
    env.AGENTS.idFromName(`${input.workspaceId}:${input.agentId}`),
  );
  return stub.fetch(
    withTrustedContext(
      new Request(`https://agent.internal/${input.operation}`, {
        method: "POST",
        headers: {
          "content-type": request.headers.get("content-type") ?? "",
        },
        body,
      }),
      {
        principal: input.principal,
        requestId: input.requestId,
        workspaceId: input.workspaceId,
      },
    ),
  );
}

export async function routeAgentMessage(
  env: Env,
  request: Request,
  input: {
    owner: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    agentId: string;
  },
) {
  if (input.owner.kind !== "user" || input.owner.role !== "owner") {
    throw new AuthorizationError(
      "Only a workspace owner can post on behalf of an agent on this device.",
    );
  }
  const command = appendMessageCommandSchema.parse(await request.json());
  const conversationId = conversationIdSchema.parse(
    command.payload.conversationId,
  );
  const agent: Principal & { kind: "agent" } = {
    kind: "agent",
    agentId: agentIdSchema.parse(input.agentId),
    workspaceId: input.workspaceId,
  };
  const stub = env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${input.workspaceId}:${conversationId}`),
  );
  return stub.fetch(
    withTrustedContext(
      new Request("https://conversation.internal/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(command),
      }),
      {
        principal: agent,
        requestId: input.requestId,
        workspaceId: input.workspaceId,
        conversationId,
      },
    ),
  );
}

function workspaceStub(env: Env, workspaceId: WorkspaceId) {
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId));
}

function accountStub(env: Env, userId: string) {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(userId));
}

async function enqueueOnboarding(
  env: Env,
  identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  entry: WorkspaceDirectoryEntry,
) {
  const principal: UserPrincipal = {
    kind: "user",
    userId: identity.userId,
    workspaceId: entry.workspaceId,
    role: "owner",
  };
  const occurredAt = entry.createdAt;
  const jobId = crypto.randomUUID();
  const request = new Request("https://agent.internal/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      commandId: entry.command.commandId,
      protocolVersion: 1,
      occurredAt,
      payload: {
        id: jobId,
        agentId: "chief",
        kind: "workspace.onboarding",
        payload: {
          name: entry.command.name,
          website: entry.command.website,
          runtime: entry.command.runtime,
          inferenceProvider: entry.command.inferenceProvider,
          inferenceModel: entry.command.inferenceModel,
          selectedApps: entry.command.selectedApps,
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
