import assert from "node:assert/strict";
import test from "node:test";

import type { SessionManager } from "../src/manager.js";
import { handleLocalTool, localToolsOpenApi } from "../src/local-tools.js";

const manager = {
  workspaceData: () =>
    Promise.resolve({
      prospects: [],
      trends: [],
      analyticsDatasets: [],
      drafts: [],
      campaigns: [],
      recurringWork: [],
    }),
} as unknown as SessionManager;

void test("embedded browser tool is discoverable and dispatches safe URLs", async () => {
  const specification = localToolsOpenApi("http://127.0.0.1:4318");
  assert.equal(
    specification.paths["/local-tools/browser/open"].post.operationId,
    "browser.open",
  );
  assert.equal(
    specification.paths["/local-tools/browser/press"].post.operationId,
    "browser.press",
  );
  assert.equal(
    specification.paths["/local-tools/browser/select"].post.operationId,
    "browser.select",
  );

  let opened: { conversationId: string; url: string } | undefined;
  const response = await handleLocalTool(
    new Request("http://127.0.0.1:4318/local-tools/browser/open", {
      method: "POST",
      body: JSON.stringify({
        conversationId: "conversation-1",
        url: "https://example.com/setup",
      }),
    }),
    "workspace-1",
    manager,
    {
      openBrowser: (conversationId, url) => {
        opened = { conversationId, url };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(opened, {
    conversationId: "conversation-1",
    url: "https://example.com/setup",
  });
});

void test("embedded browser tool rejects non-web URLs", async () => {
  const response = await handleLocalTool(
    new Request("http://127.0.0.1:4318/local-tools/browser/open", {
      method: "POST",
      body: JSON.stringify({
        conversationId: "conversation-1",
        url: "file:///tmp/not-allowed",
      }),
    }),
    "workspace-1",
    manager,
    { openBrowser: () => undefined },
  );

  assert.equal(response.status, 400);
  assert.match(await response.text(), /HTTP or HTTPS/);
});

void test("embedded browser selects an exact visible option", async () => {
  let command: unknown;
  const response = await handleLocalTool(
    new Request("http://127.0.0.1:4318/local-tools/browser/select", {
      method: "POST",
      body: JSON.stringify({
        conversationId: "conversation-1",
        labels: ["@e12"],
        values: ["90 days"],
      }),
    }),
    "workspace-1",
    manager,
    {
      browserCommand: (_conversationId, value) => {
        command = value;
        return Promise.resolve({ selected: true });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(command, {
    type: "select",
    labels: ["@e12"],
    values: ["90 days"],
  });
  assert.deepEqual(await response.json(), { selected: true });
});

void test("Google OAuth capture is host-owned and needs no download ref", async () => {
  const specification = localToolsOpenApi("http://127.0.0.1:4318");
  assert.equal(
    specification.paths["/local-tools/integrations/google-oauth/capture-client"]
      .post.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/IntegrationSetupSessionInput",
  );
  let captured: string[] | undefined;
  const response = await handleLocalTool(
    new Request(
      "http://127.0.0.1:4318/local-tools/integrations/google-oauth/capture-client",
      {
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          attemptId: "attempt-1",
        }),
      },
    ),
    "workspace-1",
    manager,
    {
      googleOAuth: {
        captureClient: (sessionId, attemptId) => {
          captured = [sessionId, attemptId];
          return Promise.resolve({ status: "configured" });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(captured, ["session-1", "attempt-1"]);
  assert.deepEqual(await response.json(), { status: "configured" });
});

void test("generated provider credentials cross only the host-owned boundary", async () => {
  const specification = localToolsOpenApi("http://127.0.0.1:4318");
  assert.equal(
    specification.paths["/local-tools/integrations/credential/capture"].post
      .operationId,
    "integration.captureGeneratedCredential",
  );
  let captured: string[] | undefined;
  const response = await handleLocalTool(
    new Request(
      "http://127.0.0.1:4318/local-tools/integrations/credential/capture",
      {
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          attemptId: "attempt-1",
        }),
      },
    ),
    "workspace-1",
    manager,
    {
      captureGeneratedCredential: (sessionId, attemptId) => {
        captured = [sessionId, attemptId];
        return Promise.resolve({ status: "configured" });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(captured, ["session-1", "attempt-1"]);
  assert.deepEqual(await response.json(), { status: "configured" });
});

void test("provider pages register an automatic authentication handoff", async () => {
  const specification = localToolsOpenApi("http://127.0.0.1:4318");
  assert.equal(
    specification.paths["/local-tools/integrations/provider/open"].post
      .operationId,
    "integration.openProviderPage",
  );
  let opened: string[] | undefined;
  const response = await handleLocalTool(
    new Request(
      "http://127.0.0.1:4318/local-tools/integrations/provider/open",
      {
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          attemptId: "attempt-1",
          url: "https://github.com/settings/personal-access-tokens/new",
        }),
      },
    ),
    "workspace-1",
    manager,
    {
      openProviderPage: (sessionId, attemptId, url) => {
        opened = [sessionId, attemptId, url];
        return Promise.resolve({ status: "authentication-required" });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(opened, [
    "session-1",
    "attempt-1",
    "https://github.com/settings/personal-access-tokens/new",
  ]);
});

void test("analytics datasets reject incomplete chart series", async () => {
  const response = await handleLocalTool(
    new Request("http://127.0.0.1:4318/local-tools/analytics/datasets", {
      method: "POST",
      body: JSON.stringify({
        provider: "google_analytics",
        sourceId: "property-1",
        key: "overview",
        title: "Overview",
        metrics: [{ key: "sessions", label: "Sessions", format: "number" }],
        dimensions: [],
        periods: [],
        series: [{ label: "Sessions", points: [] }],
      }),
    }),
    "workspace-1",
    manager,
  );

  assert.equal(response.status, 400);
  assert.match(await response.text(), /series\[0\]\.id/);
});
