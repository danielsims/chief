import assert from "node:assert/strict";
import test from "node:test";

import {
  agentActivityComponentSchema,
  appendMessageCommandSchema,
  authenticatedIdentitySchema,
  bindDeviceIdentityCommandSchema,
  boundDeviceIdentitySchema,
  eventEnvelopeSchema,
  executionLeaseSchema,
  messageComponentSchema,
  provisionWorkspaceCommandSchema,
  relativeExecutionPathSchema,
  relayDiscoverySchema,
} from "../src/index";
import { createRelayOpenApiDocument } from "../src/openapi";

const workspaceProvision = (runtime: "phone" | "cloud") => ({
  workspace: {
    commandId: "9b15b985-1a51-4c69-bc39-a941db4f7754",
    name: "Chief",
    website: "https://heychief.sh",
    runtime,
    inferenceProvider: runtime === "phone" ? "onDevice" : "openCodeGo",
    inferenceModel: runtime === "phone" ? "gemma-4-e2b" : "auto",
    selectedApps: [],
  },
  secrets: {},
});

void test("phone workspaces can keep inference entirely on device", () => {
  assert.equal(
    provisionWorkspaceCommandSchema.safeParse(workspaceProvision("phone"))
      .success,
    true,
  );
});

void test("hosted workspaces require a relay-owned inference credential", () => {
  assert.equal(
    provisionWorkspaceCommandSchema.safeParse(workspaceProvision("cloud"))
      .success,
    false,
  );
});

void test("hosted workspaces accept a workspace-scoped Vercel AI Gateway credential", () => {
  const input = workspaceProvision("cloud");
  input.workspace.inferenceProvider = "vercelAiGateway";
  input.workspace.inferenceModel = "deepseek/deepseek-v4-flash";

  assert.equal(
    provisionWorkspaceCommandSchema.safeParse({
      ...input,
      secrets: { vercelAiGateway: "workspace-gateway-key" },
    }).success,
    true,
  );
  assert.equal(
    provisionWorkspaceCommandSchema.safeParse({
      ...input,
      secrets: { opencode: "wrong-provider-key" },
    }).success,
    false,
  );
});

void test("public commands reject attempts to inject a trusted actor", () => {
  const result = appendMessageCommandSchema.safeParse({
    commandId: "cb849d0c-aa27-42d4-aa4e-933a9f28241e",
    protocolVersion: 1,
    occurredAt: "2026-08-17T00:00:00.000Z",
    actor: {
      kind: "user",
      userId: "attacker",
      workspaceId: "another-workspace",
      role: "owner",
    },
    payload: {
      messageId: "message-1",
      conversationId: "general",
      body: "Hello",
      components: [],
    },
  });

  assert.equal(result.success, false);
});

void test("authenticated identity cannot inject workspace authority", () => {
  const result = authenticatedIdentitySchema.safeParse({
    kind: "user",
    userId: "user-1",
    workspaceId: "workspace-1",
    role: "owner",
  });

  assert.equal(result.success, false);
});

void test("device binding accepts opaque Better Auth access tokens", () => {
  assert.equal(
    bindDeviceIdentityCommandSchema.safeParse({
      accountToken: `chief_at_${"a".repeat(34)}`,
    }).success,
    true,
  );
  assert.equal(
    bindDeviceIdentityCommandSchema.safeParse({ accountToken: "too-short" })
      .success,
    false,
  );
});

void test("device binding returns an expiring relay authorization", () => {
  assert.equal(
    boundDeviceIdentitySchema.safeParse({
      userId: "better-auth-user",
      pubkey: "a".repeat(64),
      deviceAuthorization: "device-authorization".repeat(3),
      expiresAt: "2026-08-22T00:00:00.000Z",
    }).success,
    true,
  );
});

void test("event envelopes require a relay-assigned sequence and actor", () => {
  const schema = eventEnvelopeSchema(appendMessageCommandSchema.shape.payload);
  const result = schema.safeParse({
    eventId: "96082155-25fc-4aca-90f1-27d2f71e81f8",
    sequence: 1,
    protocolVersion: 1,
    workspaceId: "workspace-1",
    streamId: "conversation:general",
    type: "conversation.message.appended",
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload: {
      messageId: "message-1",
      conversationId: "general",
      body: "Hello",
      components: [],
    },
  });

  assert.equal(result.success, false);
});

void test("activity components round-trip at version one and reject drift", () => {
  const component = {
    id: "tool-1",
    kind: "tool",
    version: 1,
    payload: {
      name: "relay_channels_list",
      status: "completed",
      input: "{}",
      output: '{"channels":[]}',
      runId: "run-1",
      jobId: "job-1",
      providerSessionId: "provider-1",
    },
  } as const;

  assert.deepEqual(agentActivityComponentSchema.parse(component), component);
  assert.equal(
    agentActivityComponentSchema.safeParse({ ...component, version: 2 })
      .success,
    false,
  );
  assert.equal(
    agentActivityComponentSchema.safeParse({
      ...component,
      payload: { ...component.payload, status: "invented" },
    }).success,
    false,
  );
});

void test("plugin recommendation components validate portable placement and version", () => {
  const component = {
    id: "plugin-card-1",
    kind: "plugin.recommendation",
    version: 1,
    payload: {
      workspaceId: "workspace-1",
      conversationId: "advertising",
      agentId: "ads",
      pluginId: "google-ads",
      name: "Google Ads",
      description: "Manage paid acquisition campaigns.",
      category: "Advertising",
      sourceType: "discovery",
      status: "available",
      enabled: false,
      trusted: false,
      domain: "ads.google.com",
    },
  } as const;

  assert.deepEqual(messageComponentSchema.parse(component), component);
  assert.equal(
    messageComponentSchema.safeParse({ ...component, version: 2 }).success,
    false,
  );
  assert.equal(
    messageComponentSchema.safeParse({
      ...component,
      payload: { ...component.payload, workspaceId: "wrong/workspace" },
    }).success,
    false,
  );
});

void test("plugin authorization components reject unsafe callback URLs", () => {
  const component = {
    id: "plugin-auth-1",
    kind: "plugin.authorization",
    version: 1,
    payload: {
      workspaceId: "workspace-1",
      conversationId: "advertising",
      agentId: "ads",
      pluginId: "google-ads",
      pluginName: "Google Ads",
      description: "Authorize Google Ads.",
      provider: "ads.google.com",
      authorizationUrl: "javascript:alert(1)",
      status: "authorization_required",
    },
  } as const;

  assert.equal(messageComponentSchema.safeParse(component).success, false);
  assert.equal(
    messageComponentSchema.safeParse({
      ...component,
      payload: {
        ...component.payload,
        authorizationUrl: "https://accounts.google.com/o/oauth2/auth",
      },
    }).success,
    true,
  );
});

void test("plugin authorization components accept generic OAuth clients", () => {
  const component = {
    id: "plugin-auth-1",
    kind: "plugin.authorization",
    version: 1,
    payload: {
      workspaceId: "workspace-1",
      conversationId: "analytics",
      agentId: "analyst",
      pluginId: "analytics",
      pluginName: "Analytics",
      description: "Authorize analytics administration.",
      provider: "analytics.example.com",
      kind: "plugin_oauth_client",
      serverName: "analytics-mcp",
      callbackUrl: "http://127.0.0.1:4318/plugins/oauth/callback",
      status: "client_configuration_required",
    },
  } as const;

  assert.equal(messageComponentSchema.safeParse(component).success, true);
});

void test("relay discovery is portable across hosting providers", () => {
  const discovery = relayDiscoverySchema.parse({
    protocol: "chief-relay",
    protocolVersion: 1,
    relayId: "relay_test",
    deployment: "cloudflare-byoc",
    apiBaseUrl: "https://relay.example.com/v1",
    websocketUrl: "wss://relay.example.com/v1/connect",
    openApiUrl: "https://relay.example.com/openapi.json",
    capabilities: ["workspaces", "conversations", "durable-agents"],
    authentication: {
      scheme: "NIP-98",
      signingAlgorithm: "secp256k1-schnorr",
      accountIssuer: "https://relay.example.com/api/auth",
      methods: ["email-password", "google"],
    },
  });

  assert.equal(discovery.deployment, "cloudflare-byoc");
  assert.equal(
    discovery.authentication.accountIssuer,
    "https://relay.example.com/api/auth",
  );
  assert.deepEqual(discovery.authentication.methods, [
    "email-password",
    "google",
  ]);
});

void test("OpenAPI documents idempotent message append", () => {
  const document = createRelayOpenApiDocument("https://relay.example.com");
  const path =
    document.paths[
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages"
    ];

  assert.equal(document.openapi, "3.1.0");
  assert.equal(document.servers[0].url, "https://relay.example.com");
  assert.ok(document.paths["/health"]);
  assert.ok(document.paths["/v1/workspaces/{workspaceId}/bootstrap/claim"]);
  assert.equal(path.post.operationId, "appendConversationMessage");
  assert.match(
    path.post.responses["200"].description,
    /Duplicate command ids/u,
  );
});

void test("OpenAPI documents durable reactions, files, and projects", () => {
  const paths = createRelayOpenApiDocument("https://relay.example.com").paths;
  const reactions =
    paths[
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages/{messageId}/reactions"
    ];
  const files = paths["/v1/workspaces/{workspaceId}/files"];
  const projects = paths["/v1/workspaces/{workspaceId}/projects"];

  assert.equal(reactions.get.operationId, "listMessageReactions");
  assert.equal(reactions.post.operationId, "addMessageReaction");
  assert.equal(reactions.delete.operationId, "removeMessageReaction");
  assert.equal(files.post.operationId, "saveWorkspaceFile");
  assert.equal(projects.post.operationId, "createProject");
});

void test("executor paths cannot escape their lease root", () => {
  assert.equal(
    relativeExecutionPathSchema.safeParse("../../etc/passwd").success,
    false,
  );
  assert.equal(
    relativeExecutionPathSchema.safeParse("/etc/passwd").success,
    false,
  );
  assert.equal(
    relativeExecutionPathSchema.safeParse("src/index.ts").success,
    true,
  );
});

void test("execution leases require bounded, unique capabilities", () => {
  const result = executionLeaseSchema.safeParse({
    id: "4df0cc95-5ca4-44fb-833f-1f4eddb36d4e",
    workspaceId: "workspace-a",
    agentId: "engineer",
    placementEpoch: 1,
    capabilities: ["git:read", "git:read"],
    resources: {
      cpuMillis: 1_000,
      memoryMib: 1_024,
      diskMib: 4_096,
      wallTimeSeconds: 900,
    },
    network: { mode: "allow-list", allowedHosts: ["github.com"] },
    issuedAt: "2026-08-17T00:00:00.000Z",
    expiresAt: "2026-08-17T00:15:00.000Z",
  });

  assert.equal(result.success, false);
});
