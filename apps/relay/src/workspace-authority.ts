import type {
  AuthenticatedIdentity,
  CreateWorkspaceCommand,
  Principal,
  UserPrincipal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  hexPubkeySchema,
  registerAgentKeyCommandSchema,
  userIdSchema,
  workspaceAuthorizationResultSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import { HttpError } from "./http";
import {
  withTrustedAccountIdentity,
  withTrustedContext,
  withTrustedIdentity,
} from "./internal-context";
import { recordMetrics } from "./metrics";

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
  recordMetrics(env, ["signup", "workspace-created"], {
    kind: "user",
    userId: identity.userId,
    pubkey: identity.pubkey,
    workspaceId: entry.workspaceId,
    role: "owner",
  });
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

export async function authorizeConversation(
  env: Env,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    conversationId: string;
  },
) {
  const url = new URL("https://workspace.internal/authorize-conversation");
  url.searchParams.set("conversationId", input.conversationId);
  const response = await workspaceStub(env, input.workspaceId).fetch(
    withTrustedContext(
      new Request(url, {
        method: "POST",
        headers: {
          "x-chief-internal-operation": "authorize-conversation",
        },
      }),
      input,
    ),
  );
  if (!response.ok) {
    throw new AuthorizationError(
      "The conversation is not available to this identity.",
    );
  }
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
  if (
    input.principal.kind !== "agent" ||
    input.principal.agentId !== input.agentId
  ) {
    throw new AuthorizationError(
      "An agent can only claim or complete its own mailbox jobs.",
    );
  }
  if (input.operation === "claim") {
    const authorization = await authorizeAgentRuntime(env, input);
    if (!authorization.ok) return authorization;
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

export async function routeAgentMailboxTicket(
  env: Env,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    agentId: string;
  },
) {
  if (
    input.principal.kind !== "agent" ||
    input.principal.agentId !== input.agentId
  ) {
    throw new AuthorizationError(
      "An agent can only subscribe to its own mailbox.",
    );
  }
  const authorization = await authorizeAgentRuntime(env, input);
  if (!authorization.ok) return authorization;
  const stub = env.AGENTS.get(
    env.AGENTS.idFromName(`${input.workspaceId}:${input.agentId}`),
  );
  return stub.fetch(
    withTrustedContext(
      new Request(
        `https://agent.internal/socket-tickets?agentId=${encodeURIComponent(input.agentId)}`,
        { method: "POST" },
      ),
      {
        principal: input.principal,
        requestId: input.requestId,
        workspaceId: input.workspaceId,
      },
    ),
  );
}

async function authorizeAgentRuntime(
  env: Env,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
  },
) {
  return workspaceStub(env, input.workspaceId).fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "x-chief-internal-operation": "authorize-agent-runtime",
        },
      }),
      {
        principal: input.principal,
        requestId: input.requestId,
        workspaceId: input.workspaceId,
      },
    ),
  );
}

export async function registerAgentKey(
  env: Env,
  request: Request,
  input: {
    owner: UserPrincipal;
    requestId: string;
    workspaceId: WorkspaceId;
    agentId: string;
  },
) {
  const workspace = workspaceStub(env, input.workspaceId);
  const command = registerAgentKeyCommandSchema.parse(
    JSON.parse(await request.text()),
  );
  if (command.agentId !== input.agentId) {
    throw new HttpError(
      409,
      "agent_route_mismatch",
      "The registered agent must match the agent in the request path.",
    );
  }
  return workspace.fetch(
    withTrustedIdentity(
      {
        identity: {
          kind: "user",
          userId: userIdSchema.parse(input.owner.userId),
          pubkey: hexPubkeySchema.parse(input.owner.pubkey),
        },
        requestId: input.requestId,
        workspaceId: input.workspaceId,
      },
      {
        method: "POST",
        headers: {
          "content-type": request.headers.get("content-type") ?? "",
          "x-chief-internal-operation": "register-agent-key",
        },
        body: JSON.stringify(command),
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
    pubkey: hexPubkeySchema.parse(identity.pubkey),
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
