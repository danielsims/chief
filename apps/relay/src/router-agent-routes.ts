import {
  agentIdSchema,
  jobIdSchema,
  updateWorkspaceMemberRoleResultSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { routeAgentJobAdministration } from "./agent-job-administration-router";
import { AuthorizationError } from "./auth";
import { relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { updateWorkspaceOrganizationMemberRole } from "./organization-tenancy";
import { authenticateRelayRequest } from "./router-auth";
import {
  registerAgentKey,
  routeAgentJob,
  routeAgentMailboxTicket,
} from "./workspace-agent-authority";
import { authorizeWorkspace } from "./workspace-authority";

const agentJobsRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/jobs\/(claim|complete|renew)$/u;
const agentJobListRoute = /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/jobs$/u;
const agentJobRetryRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/jobs\/([^/]+)\/retry$/u;
const agentSocketTicketRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/socket-tickets$/u;
const agentKeysRoute = /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/keys$/u;
const agentConfigRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/config$/u;
const agentResourceRoute = /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)$/u;
const agentCellSnapshotRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/cell-snapshot$/u;
const workspaceMembersRoute = /^\/v1\/workspaces\/([^/]+)\/members$/u;
const workspaceMemberRoleRoute =
  /^\/v1\/workspaces\/([^/]+)\/members\/(user|agent|service)\/([^/]+)\/role$/u;

export async function routeAgentRequest(
  env: Env,
  request: Request,
  requestId: string,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const memberRole = workspaceMemberRoleRoute.exec(url.pathname);
  if (memberRole && request.method === "PATCH") {
    const workspaceId = parseWorkspaceId(memberRole[1] ?? "");
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const target = new URL("https://workspace.internal/member-role");
    target.searchParams.set("kind", memberRole[2] ?? "");
    target.searchParams.set(
      "principalId",
      decodeURIComponent(memberRole[3] ?? ""),
    );
    const workspace = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(workspaceId),
    );
    const response = await workspace.fetch(
      withTrustedContext(
        new Request(target, {
          method: "POST",
          headers: {
            "content-type": request.headers.get("content-type") ?? "",
            "x-chief-internal-operation": "member-role-set",
          },
          body: await authenticated.request.text(),
        }),
        { principal, requestId, workspaceId },
      ),
    );
    if (response.ok && memberRole[2] === "user") {
      const { member } = updateWorkspaceMemberRoleResultSchema.parse(
        await response.clone().json(),
      );
      const { principalId: userId, role } = member;
      if (member.kind === "user") {
        await updateWorkspaceOrganizationMemberRole(env, {
          role,
          userId,
          workspaceId,
        });
      }
    }
    return response;
  }

  const agentKeys = agentKeysRoute.exec(url.pathname);
  if (agentKeys && request.method === "POST") {
    const workspaceId = parseWorkspaceId(agentKeys[1]);
    const agentId = parseAgentId(agentKeys[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    if (principal.kind !== "user" || principal.role !== "owner") {
      throw new AuthorizationError(
        "Only a workspace owner can register an agent key.",
      );
    }
    return registerAgentKey(env, authenticated.request, {
      owner: principal,
      requestId,
      workspaceId,
      agentId,
    });
  }

  const agentConfig = agentConfigRoute.exec(url.pathname);
  const agentResource = agentResourceRoute.exec(url.pathname);
  const agentRoute = agentConfig ?? agentResource;
  if (agentRoute) {
    if (
      (agentResource && request.method !== "GET") ||
      (agentConfig && request.method !== "GET" && request.method !== "POST")
    ) {
      return relayError(
        405,
        "method_not_allowed",
        "Method not allowed.",
        requestId,
      );
    }
    const workspaceId = parseWorkspaceId(agentRoute[1]);
    const agentId = parseAgentId(agentRoute[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const operation =
      agentConfig && request.method === "POST"
        ? "agent-config-set"
        : "agent-config-get";
    const target = new URL(request.url);
    target.searchParams.set("agentId", agentId);
    const body =
      agentConfig && request.method === "POST"
        ? await authenticated.request.text()
        : undefined;
    const workspace = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(workspaceId),
    );
    return workspace.fetch(
      withTrustedContext(
        new Request(target.toString(), {
          method: "POST",
          headers: {
            "content-type": request.headers.get("content-type") ?? "",
            "x-chief-internal-operation": operation,
          },
          body,
        }),
        { principal, requestId, workspaceId },
      ),
    );
  }

  const cellSnapshot = agentCellSnapshotRoute.exec(url.pathname);
  if (cellSnapshot && (request.method === "GET" || request.method === "PUT")) {
    const workspaceId = parseWorkspaceId(cellSnapshot[1]);
    const agentId = parseAgentId(cellSnapshot[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const target = new URL("https://agent.internal/snapshot");
    target.searchParams.set("agentId", agentId);
    const body =
      request.method === "PUT" ? await authenticated.request.text() : undefined;
    return env.AGENTS.get(
      env.AGENTS.idFromName(`${workspaceId}:${agentId}`),
    ).fetch(
      withTrustedContext(
        new Request(target, {
          method: request.method,
          headers: body ? { "content-type": "application/json" } : undefined,
          body,
        }),
        { principal, requestId, workspaceId },
      ),
    );
  }

  const members = workspaceMembersRoute.exec(url.pathname);
  if (members && request.method === "GET") {
    const workspaceId = parseWorkspaceId(members[1]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const workspace = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(workspaceId),
    );
    return workspace.fetch(
      withTrustedContext(
        new Request("https://workspace.internal/members", {
          method: "POST",
          headers: { "x-chief-internal-operation": "members-list" },
        }),
        { principal, requestId, workspaceId },
      ),
    );
  }

  const job = agentJobsRoute.exec(url.pathname);
  if (job && request.method === "POST") {
    const workspaceId = parseWorkspaceId(job[1]);
    const agentId = parseAgentId(job[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    return routeAgentJob(env, authenticated.request, {
      principal,
      requestId,
      workspaceId,
      agentId,
      operation:
        job[3] === "complete"
          ? "complete"
          : job[3] === "renew"
            ? "renew"
            : "claim",
    });
  }

  const jobList = agentJobListRoute.exec(url.pathname);
  if (jobList && request.method === "GET") {
    const workspaceId = parseWorkspaceId(jobList[1]);
    const agentId = parseAgentId(jobList[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    return routeAgentJobAdministration(env, {
      principal,
      requestId,
      workspaceId,
      agentId,
      operation: "list",
    });
  }

  const jobRetry = agentJobRetryRoute.exec(url.pathname);
  if (jobRetry && request.method === "POST") {
    const workspaceId = parseWorkspaceId(jobRetry[1]);
    const agentId = parseAgentId(jobRetry[2]);
    const jobId = jobIdSchema.parse(decodeURIComponent(jobRetry[3] ?? ""));
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    return routeAgentJobAdministration(env, {
      principal,
      requestId,
      workspaceId,
      agentId,
      operation: "retry",
      jobId,
    });
  }

  const ticket = agentSocketTicketRoute.exec(url.pathname);
  if (ticket && request.method === "POST") {
    const workspaceId = parseWorkspaceId(ticket[1]);
    const agentId = parseAgentId(ticket[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    return routeAgentMailboxTicket(env, {
      principal,
      requestId,
      workspaceId,
      agentId,
    });
  }
  return undefined;
}

function parseWorkspaceId(value: string | undefined) {
  return workspaceIdSchema.parse(decodeURIComponent(value ?? ""));
}

function parseAgentId(value: string | undefined) {
  return agentIdSchema.parse(decodeURIComponent(value ?? ""));
}
