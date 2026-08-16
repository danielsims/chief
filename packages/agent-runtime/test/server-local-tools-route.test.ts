import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import type { LocalToolRouteRequest } from "../src/server-local-tools-route.js";
import type { AgentToolPermission } from "../src/types.js";
import { AgentSessionCapabilityRegistry } from "../src/agent-session-capabilities.js";
import { guardedRequestHandler } from "../src/http-runtime.js";
import {
  createLocalToolsRoute,
  prepareCallerScopedToolBody,
} from "../src/server-local-tools-route.js";

const workspaceId = "workspace-route-test";
const capability = { apiBaseUrl: "https://executor.test", token: "executor" };

interface RouteState {
  caller?: { agentId: string; chatId: string; threadRootId?: string };
  enabled: boolean;
  permissions?: readonly AgentToolPermission[];
}

function routeFixture(state: RouteState) {
  const capabilities = new AgentSessionCapabilityRegistry();
  const invocations: {
    context: LocalToolRouteRequest;
    request: Request;
  }[] = [];
  const route = createLocalToolsRoute({
    origin: "http://127.0.0.1",
    capabilities,
    workspaceCapabilities: new Map([[workspaceId, capability]]),
    manager: {
      activeAgentSession: () => state.caller,
      agentPreference: () =>
        Promise.resolve({
          enabled: state.enabled,
          toolPermissions: state.permissions,
        }),
    },
    openApi: () => ({ openapi: "3.1.0" }),
    prepareBody: ({ body }) => {
      body.authoritative = true;
    },
    createContext: (request) => request,
    invoke: (request, _workspaceId, context) => {
      invocations.push({ context, request });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  return { capabilities, invocations, route };
}

async function serveRoute(
  route: ReturnType<typeof createLocalToolsRoute<LocalToolRouteRequest>>,
  run: (origin: string) => Promise<void>,
) {
  const server = createServer(
    guardedRequestHandler(async (request, response) => {
      if (await route(request, response)) return;
      response.writeHead(404).end();
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

void test("serves the local-tools specification without agent authorization", async () => {
  const fixture = routeFixture({ enabled: true });
  await serveRoute(fixture.route, async (origin) => {
    const response = await fetch(`${origin}/local-tools/openapi.json`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { openapi: "3.1.0" });
    assert.equal(fixture.invocations.length, 0);
  });
});

void test("rejects missing and inactive agent capabilities before tool execution", async () => {
  const state: RouteState = { enabled: true };
  const fixture = routeFixture(state);
  const sessionToken = fixture.capabilities.agentSession({
    workspaceId,
    agentId: "engineer",
    sessionId: "chat-engineering",
  });
  await serveRoute(fixture.route, async (origin) => {
    const missing = await fetch(`${origin}/local-tools/action`, {
      method: "POST",
    });
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: "Unauthorized" });

    state.caller = { agentId: "engineer", chatId: "different-chat" };
    const inactive = await fetch(`${origin}/local-tools/action`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    assert.equal(inactive.status, 401);
    assert.equal(
      ((await inactive.json()) as { code: string }).code,
      "agent_session_inactive",
    );
    assert.equal(fixture.invocations.length, 0);
  });
});

void test("enforces the resolved agent permission before invoking a local tool", async () => {
  const state: RouteState = {
    caller: { agentId: "researcher", chatId: "chat-research" },
    enabled: true,
    permissions: ["workspace.read"],
  };
  const fixture = routeFixture(state);
  const token = fixture.capabilities.workspaceGateway(workspaceId);
  await serveRoute(fixture.route, async (origin) => {
    const response = await fetch(`${origin}/local-tools/action`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "This agent does not have workspace.write permission.",
      code: "agent_permission_denied",
      permission: "workspace.write",
    });
    assert.equal(fixture.invocations.length, 0);
  });
});

void test("scheduled credentials cannot exceed their local permission ceiling", async () => {
  const state: RouteState = {
    caller: { agentId: "chief", chatId: "scheduled-run" },
    enabled: true,
  };
  const fixture = routeFixture(state);
  const token = fixture.capabilities.agentSession({
    workspaceId,
    agentId: "chief",
    sessionId: "scheduled-run",
    localToolPermissions: ["channels.read"],
  });
  await serveRoute(fixture.route, async (origin) => {
    const response = await fetch(`${origin}/local-tools/action`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "This scheduled run does not have workspace.write permission.",
      code: "automation_permission_denied",
      permission: "workspace.write",
    });
    assert.equal(fixture.invocations.length, 0);
  });
});

void test("injects authoritative context and invokes an authorized local tool", async () => {
  const state: RouteState = {
    caller: { agentId: "engineer", chatId: "chat-engineering" },
    enabled: true,
    permissions: ["workspace.write"],
  };
  const fixture = routeFixture(state);
  const token = fixture.capabilities.workspaceGateway(workspaceId);
  await serveRoute(fixture.route, async (origin) => {
    const response = await fetch(
      `${origin}/local-tools/action?sessionId=query-session`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sessionId: "body-session", title: "Review" }),
      },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(fixture.invocations.length, 1);
    const invocation = fixture.invocations[0];
    assert.ok(invocation);
    assert.equal(invocation.context.workspaceId, workspaceId);
    assert.equal(invocation.context.requestedSessionId, "body-session");
    assert.deepEqual(await invocation.request.json(), {
      sessionId: "body-session",
      title: "Review",
      authoritative: true,
    });
  });
});

void test("caller scope preserves public delegation but owns browser, setup, and files", () => {
  const action = {
    sourceId: "model-authored",
    threadRootId: "model-authored",
  };
  prepareCallerScopedToolBody({
    path: "/local-tools/action",
    body: action,
    callerAgentId: "chief",
    callerChatId: "channel:mission-control",
    callerThreadRootId: "heartbeat-thread",
  });
  assert.deepEqual(action, {
    sourceId: "channel:mission-control",
    threadRootId: "heartbeat-thread",
  });

  const delegation = {
    conversationId: "channel:mission-control",
    sessionId: "model-authored",
  };
  prepareCallerScopedToolBody({
    path: "/local-tools/specialists/delegate",
    body: delegation,
    callerAgentId: "setup",
    callerChatId: "specialist-setup",
    attemptId: "attempt-1",
  });
  assert.deepEqual(delegation, {
    conversationId: "channel:mission-control",
    sessionId: "model-authored",
  });

  const integration = {
    conversationId: "channel:mission-control",
    sessionId: "model-authored",
  };
  prepareCallerScopedToolBody({
    path: "/local-tools/integrations/google-analytics/authorize",
    body: integration,
    callerAgentId: "setup",
    callerChatId: "specialist-setup",
    attemptId: "attempt-1",
  });
  assert.deepEqual(integration, {
    conversationId: "channel:mission-control",
    sessionId: "specialist-setup",
    attemptId: "attempt-1",
  });

  const setup = { conversationId: "channel:mission-control" };
  prepareCallerScopedToolBody({
    path: "/local-tools/setup/start",
    body: setup,
    callerAgentId: "setup",
    callerChatId: "specialist-setup",
  });
  assert.deepEqual(setup, { conversationId: "specialist-setup" });

  const browser = {
    conversationId: "channel:mission-control",
    url: "https://accounts.google.com/",
  };
  prepareCallerScopedToolBody({
    path: "/local-tools/browser/open",
    body: browser,
    callerAgentId: "setup",
    callerChatId: "specialist-setup",
  });
  assert.deepEqual(browser, {
    conversationId: "specialist-setup",
    url: "https://accounts.google.com/",
  });

  const file = {
    agentId: "chief",
    sourceSessionId: "channel:mission-control",
  };
  prepareCallerScopedToolBody({
    path: "/local-tools/files/write",
    body: file,
    callerAgentId: "brand",
    callerChatId: "specialist-brand",
  });
  assert.deepEqual(file, {
    agentId: "brand",
    sourceSessionId: "specialist-brand",
  });
});
