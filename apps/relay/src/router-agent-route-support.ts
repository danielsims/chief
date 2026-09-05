import { z } from "zod";

import {
  agentIdSchema,
  agentSummarySchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

export async function routeOwnAgentProfile(
  env: Env,
  request: Request,
  requestId: string,
) {
  const match = /^\/v1\/workspaces\/([^/]+)\/agents\/self\/profile$/u.exec(
    new URL(request.url).pathname,
  );
  if (!match || request.method !== "GET") return undefined;
  const workspaceId = parseWorkspaceId(match[1]);
  const authenticated = await authenticateRelayRequest(request, env);
  const principal = await authorizeWorkspace(env, {
    identity: authenticated.identity,
    requestId,
    workspaceId,
  });
  if (principal.kind !== "agent")
    throw new AuthorizationError(
      "An agent identity is required to read its runtime profile.",
    );
  const response = await env.WORKSPACES.get(
    env.WORKSPACES.idFromName(workspaceId),
  ).fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: { "x-chief-internal-operation": "agent-hosting-context" },
      }),
      { principal, requestId, workspaceId },
    ),
  );
  if (!response.ok) return response;
  const { agent } = z
    .object({ agent: agentSummarySchema })
    .parse(await response.json());
  return Response.json(agent);
}

export function parseWorkspaceId(value: string | undefined) {
  return workspaceIdSchema.parse(decodeURIComponent(value ?? ""));
}

export function parseAgentId(value: string | undefined) {
  return agentIdSchema.parse(decodeURIComponent(value ?? ""));
}

export function authorizeNativeAgent(
  env: Env,
  input: {
    principal: Awaited<ReturnType<typeof authorizeWorkspace>>;
    requestId: string;
    workspaceId: ReturnType<typeof workspaceIdSchema.parse>;
    agentId: string;
  },
) {
  const target = new URL("https://workspace.internal/agents/native");
  target.searchParams.set("agentId", input.agentId);
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(input.workspaceId)).fetch(
    withTrustedContext(
      new Request(target, {
        method: "POST",
        headers: { "x-chief-internal-operation": "authorize-native-agent" },
      }),
      input,
    ),
  );
}

export async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
