import assert from "node:assert/strict";
import test from "node:test";

import { parseOrganizationInvitationUrl } from "../src/lib/organization-invitation";
import {
  resolveRelayConnection,
  validateRelayConnection,
} from "../src/lib/relay-connection";

void test("discovers the account issuer for a self-hosted relay", async () => {
  const connection = await validateRelayConnection(
    "https://chief.example.com",
    () =>
      Promise.resolve(
        Response.json({
          protocol: "chief-relay",
          protocolVersion: 1,
          deployment: "self-hosted",
          apiBaseUrl: "https://chief.example.com/v1",
          websocketUrl: "wss://chief.example.com/v1/connect",
          openApiUrl: "https://chief.example.com/v1/openapi.json",
          capabilities: ["workspaces", "conversations", "durable-agents"],
          authentication: {
            scheme: "NIP-98",
            signingAlgorithm: "secp256k1-schnorr",
            accountIssuer: "https://chief.example.com/api/auth",
          },
        }),
      ),
  );

  assert.deepEqual(connection, {
    version: 1,
    relayUrl: "https://chief.example.com",
    authBaseUrl: "https://chief.example.com",
    authUiUrl: "https://chief.example.com",
  });
});

void test("rejects insecure remote relay origins", async () => {
  await assert.rejects(
    validateRelayConnection("http://chief.example.com", fetch),
    /must use HTTPS/u,
  );
});

void test("accepts any secure relay host and custom port", async () => {
  let requestedUrl = "";
  const connection = await validateRelayConnection(
    "relay.example.com:8443",
    (input) => {
      requestedUrl =
        input instanceof URL
          ? input.href
          : typeof input === "string"
            ? input
            : input.url;
      return Promise.resolve(
        Response.json({
          protocol: "chief-relay",
          protocolVersion: 1,
          deployment: "self-hosted",
          apiBaseUrl: "https://relay.example.com:8443/v1",
          websocketUrl: "wss://relay.example.com:8443/v1/connect",
          openApiUrl: "https://relay.example.com:8443/v1/openapi.json",
          capabilities: ["workspaces"],
          authentication: {
            scheme: "NIP-98",
            signingAlgorithm: "secp256k1-schnorr",
            accountIssuer: "https://relay.example.com:8443/api/auth",
          },
        }),
      );
    },
  );

  assert.equal(
    requestedUrl,
    "https://relay.example.com:8443/.well-known/chief-relay",
  );
  assert.equal(connection.relayUrl, "https://relay.example.com:8443");
});

void test("accepts any localhost port without requiring a scheme", async () => {
  let requestedUrl = "";
  const connection = await validateRelayConnection(
    "localhost:8080",
    (input) => {
      requestedUrl =
        input instanceof URL
          ? input.href
          : typeof input === "string"
            ? input
            : input.url;
      return Promise.resolve(
        Response.json({
          protocol: "chief-relay",
          protocolVersion: 1,
          deployment: "self-hosted",
          apiBaseUrl: "http://localhost:8080/v1",
          websocketUrl: "ws://localhost:8080/v1/connect",
          openApiUrl: "http://localhost:8080/v1/openapi.json",
          capabilities: ["workspaces"],
          authentication: {
            scheme: "NIP-98",
            signingAlgorithm: "secp256k1-schnorr",
            accountIssuer: "http://localhost:8080/api/auth",
          },
        }),
      );
    },
  );

  assert.equal(requestedUrl, "http://localhost:8080/.well-known/chief-relay");
  assert.equal(connection.relayUrl, "http://localhost:8080");
});

void test("resolves both cloud and custom relay sessions for workspace switching", () => {
  const cloud = {
    version: 1 as const,
    relayUrl: "https://cloud-relay.example.com",
    authBaseUrl: "https://cloud-auth.example.com",
    authUiUrl: "https://chief.example.com",
  };
  const custom = {
    version: 1 as const,
    relayUrl: "https://relay-two.example.com",
    authBaseUrl: "https://relay-two.example.com",
    authUiUrl: "https://relay-two.example.com",
  };

  assert.deepEqual(
    resolveRelayConnection(cloud.relayUrl, [custom], cloud),
    cloud,
  );
  assert.deepEqual(
    resolveRelayConnection(custom.relayUrl, [custom], cloud),
    custom,
  );
});

void test("organization invitations retain their foreign relay boundary", () => {
  assert.deepEqual(
    parseOrganizationInvitationUrl(
      "chief-desktop://organization-invite?relay=https%3A%2F%2Frelay.example.com&workspace=workspace-acme",
    ),
    {
      relayUrl: "https://relay.example.com",
      workspaceId: "workspace-acme",
    },
  );
});

void test("organization invitations reject unsafe remote relays", () => {
  assert.throws(
    () =>
      parseOrganizationInvitationUrl(
        "chief-desktop://organization-invite?relay=http%3A%2F%2Frelay.example.com&workspace=workspace-acme",
      ),
    /unsafe relay/u,
  );
});
