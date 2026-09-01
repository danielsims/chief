import type {
  Principal,
  UserPrincipal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  hexPubkeySchema,
  registerAgentKeyCommandSchema,
  userIdSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import { HttpError } from "./http";
import { withTrustedContext, withTrustedIdentity } from "./internal-context";
import { workspaceStub } from "./workspace-stubs";

export async function routeAgentJob(
  env: Env,
  request: Request,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    agentId: string;
    operation: "claim" | "complete" | "renew";
  },
) {
  assertOwnAgentMailbox(input.principal, input.agentId, "claim or complete");
  const authorization = await authorizeAgentRuntime(env, input);
  if (!authorization.ok) return authorization;
  const body = await request.text();
  return agentStub(env, input.workspaceId, input.agentId).fetch(
    withTrustedContext(
      new Request(`https://agent.internal/${input.operation}`, {
        method: "POST",
        headers: {
          "content-type": request.headers.get("content-type") ?? "",
        },
        body,
      }),
      trustedAgentContext(input),
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
  assertOwnAgentMailbox(input.principal, input.agentId, "subscribe to");
  const authorization = await authorizeAgentRuntime(env, input);
  if (!authorization.ok) return authorization;
  return agentStub(env, input.workspaceId, input.agentId).fetch(
    withTrustedContext(
      new Request(
        `https://agent.internal/socket-tickets?agentId=${encodeURIComponent(input.agentId)}`,
        { method: "POST" },
      ),
      trustedAgentContext(input),
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
  return workspaceStub(env, input.workspaceId).fetch(
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

function assertOwnAgentMailbox(
  principal: Principal,
  agentId: string,
  operation: string,
) {
  if (principal.kind !== "agent" || principal.agentId !== agentId) {
    throw new AuthorizationError(
      `An agent can only ${operation} its own mailbox jobs.`,
    );
  }
}

function agentStub(env: Env, workspaceId: WorkspaceId, agentId: string) {
  return env.AGENTS.get(env.AGENTS.idFromName(`${workspaceId}:${agentId}`));
}

function trustedAgentContext(input: {
  principal: Principal;
  requestId: string;
  workspaceId: WorkspaceId;
}) {
  return {
    principal: input.principal,
    requestId: input.requestId,
    workspaceId: input.workspaceId,
  };
}

function authorizeAgentRuntime(
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
        headers: { "x-chief-internal-operation": "authorize-agent-runtime" },
      }),
      trustedAgentContext(input),
    ),
  );
}
