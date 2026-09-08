import type { Principal, WorkspaceId } from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import { withTrustedContext } from "./internal-context";

export async function routeAgentJobAdministration(
  env: Env,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    agentId: string;
    operation: "list" | "retry";
    jobId?: string;
  },
) {
  if (
    input.principal.kind !== "user" ||
    (input.principal.role !== "owner" && input.principal.role !== "admin")
  ) {
    throw new AuthorizationError(
      "Only a workspace owner or admin can inspect and retry agent runs.",
    );
  }
  const target = new URL("https://workspace.internal/agents/native");
  target.searchParams.set("agentId", input.agentId);
  const authorized = await env.WORKSPACES.get(
    env.WORKSPACES.idFromName(input.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request(target, {
        method: "POST",
        headers: { "x-chief-internal-operation": "authorize-native-agent" },
      }),
      {
        principal: input.principal,
        requestId: input.requestId,
        workspaceId: input.workspaceId,
      },
    ),
  );
  if (!authorized.ok) return authorized;
  const stub = env.AGENTS.get(
    env.AGENTS.idFromName(`${input.workspaceId}:${input.agentId}`),
  );
  const path =
    input.operation === "list"
      ? "jobs"
      : `jobs/${encodeURIComponent(input.jobId ?? "")}/retry`;
  return stub.fetch(
    withTrustedContext(
      new Request(`https://agent.internal/${path}`, {
        method: input.operation === "list" ? "GET" : "POST",
      }),
      {
        principal: input.principal,
        requestId: input.requestId,
        workspaceId: input.workspaceId,
      },
    ),
  );
}
