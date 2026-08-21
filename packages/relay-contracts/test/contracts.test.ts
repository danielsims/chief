import assert from "node:assert/strict";
import test from "node:test";

import {
  appendMessageCommandSchema,
  authenticatedIdentitySchema,
  bindDeviceIdentityCommandSchema,
  boundDeviceIdentitySchema,
  eventEnvelopeSchema,
  executionLeaseSchema,
  relativeExecutionPathSchema,
  relayDiscoverySchema,
} from "../src/index";
import { createRelayOpenApiDocument } from "../src/openapi";

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

void test("relay discovery is portable across hosting providers", () => {
  const discovery = relayDiscoverySchema.parse({
    protocol: "chief-relay",
    protocolVersion: 1,
    deployment: "cloudflare-byoc",
    apiBaseUrl: "https://relay.example.com/v1",
    websocketUrl: "wss://relay.example.com/v1/connect",
    openApiUrl: "https://relay.example.com/openapi.json",
    capabilities: ["workspaces", "conversations", "durable-agents"],
    authentication: {
      scheme: "NIP-98",
      signingAlgorithm: "secp256k1-schnorr",
      accountIssuer: "https://relay.example.com/api/auth",
    },
  });

  assert.equal(discovery.deployment, "cloudflare-byoc");
  assert.equal(
    discovery.authentication.accountIssuer,
    "https://relay.example.com/api/auth",
  );
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
