import assert from "node:assert/strict";
import test from "node:test";

import { workspaceIdSchema } from "@chief/relay-contracts";

import { RelayClient } from "../src/relay-client";

void test("scopes requests to one workspace and keeps bearer tokens out of socket URLs", async () => {
  const requests: { url: string; authorization: string | null }[] = [];
  let socketUrl = "";
  const fetcher: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers = new Headers(init?.headers);
    requests.push({ url, authorization: headers.get("authorization") });
    if (url.endsWith("/.well-known/chief-relay")) {
      return Promise.resolve(
        jsonResponse({
          protocol: "chief-relay",
          protocolVersion: 1,
          deployment: "chief-cloud",
          apiBaseUrl: "https://relay.test/v1",
          websocketUrl: "wss://relay.test/v1/connect",
          openApiUrl: "https://relay.test/v1/openapi.json",
          capabilities: ["workspaces", "conversations", "durable-agents"],
          authentication: {
            issuer: "https://identity.test",
            audience: "chief-relay",
            jwksUrl: "https://identity.test/.well-known/jwks.json",
          },
        }),
      );
    }
    if (url.endsWith("/socket-tickets")) {
      return Promise.resolve(
        jsonResponse(
          {
            ticket: "socket-ticket-with-enough-entropy-to-be-valid-1234567890",
            expiresAt: "2026-08-17T00:00:30.000Z",
          },
          201,
        ),
      );
    }
    if (url.includes("/events")) {
      return Promise.resolve(jsonResponse({ events: [], nextSequence: null }));
    }
    return Promise.resolve(jsonResponse({ messages: [], nextSequence: null }));
  };
  const client = new RelayClient({
    relayUrl: "https://relay.test/ignored/path",
    workspaceId: workspaceIdSchema.parse("workspace-a"),
    getAccessToken: () => Promise.resolve("private-access-token"),
    fetch: fetcher,
    createWebSocket: (url) => {
      socketUrl = url;
      return new FakeWebSocket() as unknown as WebSocket;
    },
  });

  await client.listMessages("general");
  const subscription = await client.subscribeConversation({
    conversationId: "general",
    onEvent: () => undefined,
  });
  subscription.close();

  assert.match(
    requests[0]?.url ?? "",
    /\/v1\/workspaces\/workspace-a\/conversations\/general\/messages/u,
  );
  assert.equal(requests[0]?.authorization, "Bearer private-access-token");
  assert.equal(requests[1]?.authorization, null);
  assert.equal(requests[2]?.authorization, "Bearer private-access-token");
  assert.match(socketUrl, /ticket=socket-ticket/u);
  assert.doesNotMatch(socketUrl, /private-access-token/u);
  assert.match(socketUrl, /workspaceId=workspace-a/u);
});

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  readyState = 0;

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  close() {
    this.readyState = 3;
  }
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
