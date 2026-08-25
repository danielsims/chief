import assert from "node:assert/strict";
import test from "node:test";

import type { JsonObject } from "@chief/relay-contracts";
import {
  isJsonString,
  parseJsonObject,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { RelayClient } from "../src/relay-client";

const relayDiscovery = {
  protocol: "chief-relay",
  protocolVersion: 1,
  deployment: "chief-cloud",
  apiBaseUrl: "https://relay.test/v1",
  websocketUrl: "wss://relay.test/v1/connect",
  openApiUrl: "https://relay.test/v1/openapi.json",
  capabilities: ["workspaces", "conversations", "durable-agents"],
  authentication: {
    scheme: "NIP-98",
    signingAlgorithm: "secp256k1-schnorr",
    accountIssuer: "https://relay.test/api/auth",
  },
};

void test("scopes NIP-98 requests to one workspace and keeps authorization out of socket URLs", async () => {
  const requests: {
    url: string;
    authorization: string | null;
    deviceAuthorization: string | null;
  }[] = [];
  let socketUrl = "";
  const fetcher: typeof fetch = (input, init) => {
    const url = isJsonString(input)
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const headers = new Headers(init?.headers);
    requests.push({
      url,
      authorization: headers.get("authorization"),
      deviceAuthorization: headers.get("x-chief-device-authorization"),
    });
    if (url.endsWith("/.well-known/chief-relay")) {
      return Promise.resolve(jsonResponse(relayDiscovery));
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
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    getDeviceAuthorization: () =>
      Promise.resolve("relay-signed-device-authorization"),
    fetch: fetcher,
    createWebSocket: (url) => {
      socketUrl = url;
      return new FakeWebSocket();
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
  assert.equal(requests[0]?.authorization, "Nostr signed-request");
  assert.equal(
    requests[0].deviceAuthorization,
    "relay-signed-device-authorization",
  );
  assert.equal(requests[1]?.authorization, null);
  assert.equal(requests[1].deviceAuthorization, null);
  assert.equal(requests[2]?.authorization, "Nostr signed-request");
  assert.equal(
    requests[2].deviceAuthorization,
    "relay-signed-device-authorization",
  );
  assert.match(socketUrl, /ticket=socket-ticket/u);
  assert.doesNotMatch(socketUrl, /signed-request/u);
  assert.match(socketUrl, /workspaceId=workspace-a/u);
});

void test("loads the current and workspace channel rosters from relay membership endpoints", async () => {
  const paths: string[] = [];
  const membership = {
    conversationId: "general",
    kind: "user" as const,
    principalId: "user-a",
    role: "owner" as const,
    joinedAt: "2026-08-21T00:00:00.000Z",
  };
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: "workspace-a",
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: (input) => {
      const url = new URL(
        isJsonString(input)
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      paths.push(url.pathname);
      return Promise.resolve(jsonResponse({ memberships: [membership] }));
    },
  });

  assert.deepEqual(await client.listCurrentChannelMemberships(), [membership]);
  assert.deepEqual(await client.listChannelMemberships(), [membership]);
  assert.deepEqual(paths, [
    "/v1/workspaces/workspace-a/channels/memberships/self",
    "/v1/workspaces/workspace-a/channels/memberships",
  ]);
});

void test("scopes per-agent configuration to the selected workspace", async () => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const config = {
    enabled: true,
    deploymentTarget: "cloud" as const,
    inference: {
      provider: "opencode" as const,
      model: "opencode-go/deepseek-v4-flash" as const,
    },
    approvals: "auto" as const,
    capabilities: [],
    integrations: [],
    toolPermissions: ["workspace.read" as const],
  };
  const account = new RelayClient({
    relayUrl: "https://relay.test",
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: (input, init) => {
      const url = new URL(
        isJsonString(input)
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      requests.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        body: isJsonString(init?.body) ? JSON.parse(init.body) : null,
      });
      return Promise.resolve(
        url.pathname.endsWith("/keys")
          ? jsonResponse({ agentId: "chief", pubkey: "a".repeat(64) })
          : jsonResponse({
              agentId: "chief",
              config,
              updatedAt: "2026-08-21T00:00:00.000Z",
            }),
      );
    },
  });
  const workspace = account.forWorkspace("workspace-a");

  assert.equal(
    (await workspace.loadAgentConfig("chief")).config.inference.provider,
    "opencode",
  );
  await workspace.saveAgentConfig("chief", config);
  await workspace.registerAgentKey("chief", "a".repeat(64));

  assert.deepEqual(requests, [
    {
      method: "GET",
      path: "/v1/workspaces/workspace-a/agents/chief/config",
      body: null,
    },
    {
      method: "POST",
      path: "/v1/workspaces/workspace-a/agents/chief/config",
      body: { agentId: "chief", config },
    },
    {
      method: "POST",
      path: "/v1/workspaces/workspace-a/agents/chief/keys",
      body: { agentId: "chief", pubkey: "a".repeat(64) },
    },
  ]);
});

void test("renews socket tickets and catches up from the durable cursor after reconnect", async () => {
  const sockets: FakeWebSocket[] = [];
  const eventAfters: number[] = [];
  let ticketCount = 0;
  const received: number[] = [];
  const fetcher: typeof fetch = (input) => {
    const url = new URL(
      isJsonString(input)
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/.well-known/chief-relay") {
      return Promise.resolve(jsonResponse(relayDiscovery));
    }
    if (url.pathname.endsWith("/socket-tickets")) {
      ticketCount += 1;
      return Promise.resolve(
        jsonResponse(
          {
            ticket: `socket-ticket-${ticketCount}-with-enough-entropy-1234567890`,
            expiresAt: "2026-08-17T00:00:30.000Z",
          },
          201,
        ),
      );
    }
    if (url.pathname.endsWith("/events")) {
      const after = Number(url.searchParams.get("after") ?? 0);
      eventAfters.push(after);
      return Promise.resolve(
        jsonResponse({
          events:
            after === 1 ? [conversationEvent(2), conversationEvent(3)] : [],
          nextSequence: null,
        }),
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: "workspace-a",
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: fetcher,
    createWebSocket: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  const subscription = await client.subscribeConversation({
    conversationId: "general",
    after: 1,
    onEvent: (event) => received.push(event.sequence),
  });
  sockets[0]?.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 1_100));

  assert.equal(ticketCount, 2);
  assert.deepEqual(eventAfters, [1, 3]);
  assert.deepEqual(received, [2, 3]);
  assert.equal(subscription.cursor(), 3);
  subscription.close();
});

void test("does not retry a terminal authorization failure after a live disconnect", async () => {
  const sockets: FakeWebSocket[] = [];
  let ticketCount = 0;
  const errors: string[] = [];
  const fetcher: typeof fetch = (input) => {
    const url = new URL(
      isJsonString(input)
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/.well-known/chief-relay") {
      return Promise.resolve(jsonResponse(relayDiscovery));
    }
    if (url.pathname.endsWith("/socket-tickets")) {
      ticketCount += 1;
      return ticketCount === 1
        ? Promise.resolve(
            jsonResponse(
              {
                ticket:
                  "socket-ticket-1-with-enough-entropy-to-be-valid-1234567890",
                expiresAt: "2026-08-17T00:00:30.000Z",
              },
              201,
            ),
          )
        : Promise.resolve(
            jsonResponse(
              { error: { code: "forbidden", message: "Access revoked." } },
              403,
            ),
          );
    }
    if (url.pathname.endsWith("/events")) {
      return Promise.resolve(jsonResponse({ events: [], nextSequence: null }));
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: "workspace-a",
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: fetcher,
    createWebSocket: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  const subscription = await client.subscribeConversation({
    conversationId: "general",
    onEvent: () => undefined,
    onError: (error) => errors.push(error.message),
  });
  sockets[0]?.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await new Promise((resolve) => setTimeout(resolve, 1_100));

  assert.equal(ticketCount, 2);
  assert.deepEqual(errors, ["Access revoked."]);
  subscription.close();
});

void test("multiplexes workspace conversations over one cursor-resumable socket", async () => {
  const sockets: FakeWebSocket[] = [];
  const received: number[] = [];
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: "workspace-a",
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: (input) => {
      const url = new URL(
        isJsonString(input)
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.pathname === "/.well-known/chief-relay") {
        return Promise.resolve(jsonResponse(relayDiscovery));
      }
      if (url.pathname === "/v1/workspaces/workspace-a/socket-tickets") {
        return Promise.resolve(
          jsonResponse(
            {
              ticket:
                "workspace-ticket-with-enough-entropy-to-be-valid-1234567890",
              expiresAt: "2026-08-17T00:00:30.000Z",
              cursor: 41,
            },
            201,
          ),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    createWebSocket: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  const subscription = await client.subscribeWorkspace({
    conversationIds: ["general", "mission-control", "general"],
    onEvent: (event) => received.push(event.sequence),
  });
  subscription.updateConversationIds(["engineering", "general"]);
  sockets[0]?.receive(conversationEvent(42));

  assert.equal(sockets.length, 1);
  assert.deepEqual(
    sockets[0]?.sent.map((value) => parseJsonObject(JSON.parse(value)) ?? {}),
    [
      {
        type: "workspace.subscribe",
        conversationIds: ["general", "mission-control"],
        after: 41,
      },
      {
        type: "workspace.subscribe",
        conversationIds: ["engineering", "general"],
        after: 41,
      },
    ],
  );
  assert.deepEqual(received, [42]);
  assert.equal(subscription.cursor(), 42);
  subscription.close();
});

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  readyState = 0;
  readonly sent: string[] = [];

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  disconnect() {
    this.close();
  }

  send(value: string) {
    this.sent.push(value);
  }

  receive(value: JsonObject) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
}

function conversationEvent(sequence: number) {
  return {
    eventId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    protocolVersion: 1,
    workspaceId: "workspace-a",
    streamId: "conversation:general",
    type: "conversation.message.appended",
    actor: {
      kind: "agent",
      agentId: "chief",
      pubkey: "a".repeat(64),
      workspaceId: "workspace-a",
      role: "member",
    },
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload: {
      message: {
        id: `message-${sequence}`,
        workspaceId: "workspace-a",
        conversationId: "general",
        body: `Message ${sequence}`,
        author: { kind: "agent", id: "chief" },
        createdAt: "2026-08-17T00:00:00.000Z",
        sequence,
        mentions: [],
        components: [],
        reactions: [],
        edited: false,
        deleted: false,
      },
    },
  };
}

function jsonResponse(value: JsonObject, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
