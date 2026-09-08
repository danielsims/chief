import { agentIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import { EXTERNAL_CHANNEL_AUTHORIZATION_HEADER } from "./external-agent-channel-security";
import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const registrationRoute = /^\/v1\/workspaces\/([^/]+)\/agents\/external$/u;
const disconnectRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/external$/u;
const rotateRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/external\/credentials\/rotate$/u;
const verifyRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/external\/verify$/u;
const endpointRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/external\/endpoint$/u;
const messageRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/channel\/messages$/u;
const activityRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/channel\/activity$/u;
const toolsRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/channel\/tools$/u;
const requeueRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/channel\/deliveries\/([^/]+)\/requeue$/u;
const reconciliationListRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/channel\/deliveries\/reconciling$/u;

export async function routeExternalAgentRequest(
  env: Env,
  request: Request,
  requestId: string,
) {
  const url = new URL(request.url);
  const verification = verifyRoute.exec(url.pathname);
  if (verification && request.method === "POST") {
    const workspaceId = workspaceIdSchema.parse(verification[1]);
    agentIdSchema.parse(verification[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const headers = new Headers(authenticated.request.headers);
    headers.set("x-chief-internal-operation", "external-agent-verify");
    const body = await authenticated.request.text();
    const init: RequestInit = { method: "POST", headers };
    if (body) init.body = body;
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
      withTrustedContext(new Request(request.url, init), {
        principal,
        requestId,
        workspaceId,
      }),
    );
  }
  const endpointUpdate = endpointRoute.exec(url.pathname);
  if (endpointUpdate && request.method === "POST") {
    const workspaceId = workspaceIdSchema.parse(endpointUpdate[1]);
    agentIdSchema.parse(endpointUpdate[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const headers = new Headers(authenticated.request.headers);
    headers.set("x-chief-internal-operation", "external-agent-endpoint");
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
      withTrustedContext(
        new Request(request.url, {
          method: "POST",
          headers,
          body: await authenticated.request.text(),
        }),
        { principal, requestId, workspaceId },
      ),
    );
  }
  const reconciliationList = reconciliationListRoute.exec(url.pathname);
  if (reconciliationList && request.method === "GET") {
    const workspaceId = workspaceIdSchema.parse(reconciliationList[1]);
    agentIdSchema.parse(reconciliationList[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const headers = new Headers(authenticated.request.headers);
    headers.set("x-chief-internal-operation", "external-agent-reconciliations");
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
      withTrustedContext(new Request(request.url, { method: "GET", headers }), {
        principal,
        requestId,
        workspaceId,
      }),
    );
  }
  const recovery = recoveryRoute.exec(url.pathname);
  if (recovery && request.method === "POST") {
    const workspaceId = workspaceIdSchema.parse(recovery[1]);
    agentIdSchema.parse(recovery[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const headers = new Headers(authenticated.request.headers);
    headers.set("x-chief-internal-operation", "external-agent-recover");
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
      withTrustedContext(
        new Request(request.url, {
          method: "POST",
          headers,
          body: await authenticated.request.text(),
        }),
        { principal, requestId, workspaceId },
      ),
    );
  }
  const rotation = rotateRoute.exec(url.pathname);
  if (rotation && request.method === "POST") {
    const workspaceId = workspaceIdSchema.parse(rotation[1]);
    agentIdSchema.parse(rotation[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const headers = new Headers(authenticated.request.headers);
    headers.set("x-chief-internal-operation", "external-agent-rotate");
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
      withTrustedContext(
        new Request(request.url, { method: "POST", headers }),
        {
          principal,
          requestId,
          workspaceId,
        },
      ),
    );
  }
  const disconnect = disconnectRoute.exec(url.pathname);
  if (disconnect && request.method === "DELETE") {
    const workspaceId = workspaceIdSchema.parse(disconnect[1]);
    agentIdSchema.parse(disconnect[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const headers = new Headers(authenticated.request.headers);
    headers.set("x-chief-internal-operation", "external-agent-disconnect");
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
      withTrustedContext(
        new Request(request.url, { method: "DELETE", headers }),
        { principal, requestId, workspaceId },
      ),
    );
  }
  const requeue = requeueRoute.exec(url.pathname);
  if (requeue && request.method === "POST") {
    const workspaceId = workspaceIdSchema.parse(requeue[1]);
    agentIdSchema.parse(requeue[2]);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    const headers = new Headers(authenticated.request.headers);
    headers.set("x-chief-internal-operation", "external-agent-requeue");
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
      withTrustedContext(
        new Request(request.url, { method: "POST", headers }),
        {
          principal,
          requestId,
          workspaceId,
        },
      ),
    );
  }
  const inbound =
    messageRoute.exec(url.pathname) ??
    activityRoute.exec(url.pathname) ??
    toolsRoute.exec(url.pathname);
  if (inbound && request.method === "POST") {
    const workspaceId = workspaceIdSchema.parse(inbound[1]);
    agentIdSchema.parse(inbound[2]);
    const headers = new Headers(request.headers);
    headers.set(
      "x-chief-internal-operation",
      inboundChannelOperation(url.pathname),
    );
    headers.set(
      EXTERNAL_CHANNEL_AUTHORIZATION_HEADER,
      request.headers.get("authorization") ?? "",
    );
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
      withTrustedContext(
        new Request(request.url, {
          method: "POST",
          headers,
          body: request.body,
        }),
        {
          principal: {
            kind: "service",
            service: "external-agent-channel",
            workspaceId,
          },
          requestId,
          workspaceId,
        },
      ),
    );
  }

  const registration = registrationRoute.exec(url.pathname);
  if (!registration || request.method !== "POST") return undefined;
  const workspaceId = workspaceIdSchema.parse(registration[1]);
  const authenticated = await authenticateRelayRequest(request, env);
  const principal = await authorizeWorkspace(env, {
    identity: authenticated.identity,
    requestId,
    workspaceId,
  });
  const headers = new Headers(authenticated.request.headers);
  headers.set("x-chief-internal-operation", "external-agent-register");
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
    withTrustedContext(
      new Request(request.url, {
        method: "POST",
        headers,
        body: await authenticated.request.text(),
      }),
      { principal, requestId, workspaceId },
    ),
  );
}
const recoveryRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/channel\/deliveries\/([^/]+)\/recover$/u;
function inboundChannelOperation(pathname: string) {
  if (toolsRoute.test(pathname)) return "external-agent-tools";
  if (activityRoute.test(pathname)) return "external-agent-activity";
  return "external-agent-message";
}
