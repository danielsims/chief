import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { userIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import {
  withTrustedContext,
  withTrustedSocketTicket,
} from "../src/internal-context";

const workspaceId = workspaceIdSchema.parse("workspace-a");
const userId = userIdSchema.parse("user-a");
const conversationId = "general";

describe("ConversationObject", () => {
  it("persists an append once when the command is retried", async () => {
    const stub = conversationStub();
    const command = appendCommand({
      commandId: "04b4d5c7-bb58-4646-ac0d-9e229a09a800",
      messageId: "message-1",
    });

    const first = await post(stub, command);
    const retry = await post(stub, command);
    const page = await list(stub);
    const events = await listEvents(stub);

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ duplicate: false });
    expect(await retry.json()).toMatchObject({ duplicate: true });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({
      id: "message-1",
      body: "Hello from the durable relay.",
      sequence: 1,
    });
    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toMatchObject({
      sequence: 1,
      type: "conversation.message.appended",
      actor: { kind: "user", userId },
    });
  });

  it("rejects a command routed to a different conversation", async () => {
    const response = await post(
      conversationStub(),
      appendCommand({
        commandId: "17fb899d-226f-4ae2-b1d6-a75a5fd0d501",
        messageId: "message-2",
        routedConversationId: "another-channel",
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "conversation_mismatch" },
    });
  });

  it("accepts each scoped socket ticket only once", async () => {
    const stub = conversationStub();
    const ticketResponse = await stub.fetch(
      trustedRequest("https://relay.test/internal/socket-tickets", {
        method: "POST",
      }),
    );
    const ticket = (await ticketResponse.json()) as { ticket: string };
    const connectRequest = () =>
      withTrustedSocketTicket(new Request("https://relay.test/v1/connect"), {
        ticket: ticket.ticket,
        requestId: crypto.randomUUID(),
        workspaceId,
        conversationId,
      });
    const connected = await stub.fetch(connectRequest());
    const replayed = await stub.fetch(connectRequest());

    expect(ticketResponse.status).toBe(201);
    expect(connected.status).toBe(101);
    expect(replayed.status).toBe(401);
    expect(await replayed.json()).toMatchObject({
      error: { code: "invalid_socket_ticket" },
    });
  });
});

function conversationStub() {
  const conversations = (
    env as unknown as { CONVERSATIONS: DurableObjectNamespace }
  ).CONVERSATIONS;
  const id = conversations.idFromName(`${workspaceId}:${conversationId}`);
  return conversations.get(id);
}

function appendCommand(input: {
  commandId: string;
  messageId: string;
  routedConversationId?: string;
}) {
  return {
    commandId: input.commandId,
    protocolVersion: 1,
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload: {
      messageId: input.messageId,
      conversationId: input.routedConversationId ?? conversationId,
      body: "Hello from the durable relay.",
      components: [],
    },
  };
}

async function post(stub: DurableObjectStub, body: unknown) {
  const request = trustedRequest("https://relay.test/internal/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return stub.fetch(request);
}

async function list(stub: DurableObjectStub) {
  const response = await stub.fetch(
    trustedRequest("https://relay.test/internal/messages?after=0&limit=50"),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    messages: Array<{ id: string; body: string; sequence: number }>;
  };
}

async function listEvents(stub: DurableObjectStub) {
  const response = await stub.fetch(
    trustedRequest("https://relay.test/internal/events?after=0&limit=50"),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    events: Array<{
      sequence: number;
      type: string;
      actor: { kind: string; userId?: string };
    }>;
  };
}

function trustedRequest(url: string, init?: RequestInit) {
  return withTrustedContext(new Request(url, init), {
    principal: {
      kind: "user",
      userId,
      workspaceId,
      role: "owner",
    },
    requestId: crypto.randomUUID(),
    workspaceId,
    conversationId,
  });
}
