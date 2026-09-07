import { describe, expect, it } from "vitest";

import type { JsonObject } from "@chief/relay-contracts";
import {
  agentIdSchema,
  appendMessageCommandSchema,
  userIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import {
  withTrustedContext,
  withTrustedSocketTicket,
} from "../src/internal-context";
import { hexKey, relayTestEnv } from "./helpers";

const workspaceId = workspaceIdSchema.parse("workspace-a");
const userId = userIdSchema.parse("user-a");
const conversationId = "general";
const agentId = agentIdSchema.parse("advertising");

describe("ConversationObject", () => {
  it("loads a notification thread root directly and returns 404 for a missing root", async () => {
    const stub = conversationStub("notification-root");
    await post(
      stub,
      appendCommand({
        commandId: crypto.randomUUID(),
        messageId: "notification-root",
        body: "Scheduled work",
      }),
    );
    const found = await stub.fetch(
      trustedRequest(
        "https://relay.test/internal/messages/notification-root",
        {},
      ),
    );
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      message: { id: "notification-root", body: "Scheduled work" },
    });
    const missing = await stub.fetch(
      trustedRequest("https://relay.test/internal/messages/no-such-root", {}),
    );
    expect(missing.status).toBe(404);
  });
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
      actor: { kind: "user", userId, pubkey: hexKey(userId) },
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

  it("adds and removes a reaction idempotently and broadcasts one event", async () => {
    const stub = conversationStub();
    const command = appendCommand({
      commandId: "8c01d06c-89fd-42e9-9643-a56a5f6e6d01",
      messageId: "reaction-root",
    });
    expect((await post(stub, command)).status).toBe(200);

    const add = await react(stub, "reaction-root", "🔥");
    const addAgain = await react(stub, "reaction-root", "🔥");
    const remove = await react(stub, "reaction-root", "🔥", "DELETE");
    const removeAgain = await react(stub, "reaction-root", "🔥", "DELETE");

    expect(add.status).toBe(200);
    expect(await add.json()).toMatchObject({
      add: true,
      message: {
        id: "reaction-root",
        reactions: [{ emoji: "🔥", pubkeys: [hexKey(userId)] }],
      },
    });
    expect(await addAgain.json()).toMatchObject({
      add: true,
      message: { reactions: [{ emoji: "🔥", pubkeys: [hexKey(userId)] }] },
    });
    expect(await remove.json()).toMatchObject({
      add: false,
      message: { reactions: [] },
    });
    expect(await removeAgain.json()).toMatchObject({
      add: false,
      message: { reactions: [] },
    });

    // A duplicate add/remove must not append duplicate reaction events. Only
    // the first add and the first remove change the set, so exactly two
    // reaction events are expected.
    const events = await listEvents(stub);
    const reactionEvents = events.events.filter(
      (event) => event.type === "conversation.message.reacted",
    );
    expect(reactionEvents).toHaveLength(2);
  });

  it("lists thread replies for a root message", async () => {
    const stub = conversationStub();
    await post(
      stub,
      appendCommand({
        commandId: "1d93e3d0-9c92-44b6-8cf2-3c9820b25001",
        messageId: "thread-root",
      }),
    );
    const reply = await post(
      stub,
      appendCommand({
        commandId: "6e93e3d0-9c92-44b6-8cf2-3c9820b25002",
        messageId: "thread-reply",
        threadRootId: "thread-root",
      }),
    );
    expect(reply.status).toBe(200);

    const response = await stub.fetch(
      trustedRequest(
        "https://relay.test/internal/messages/thread-root/replies?after=0&limit=50",
      ),
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as { messages: Array<{ id: string }> };
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ id: "thread-reply" });
  });

  it("searches message bodies with a query parameter", async () => {
    const stub = conversationStub();
    await post(
      stub,
      appendCommand({
        commandId: "7a9a3d09-9c92-44b6-8cf2-3c9820b25003",
        messageId: "search-one",
      }),
    );
    await post(
      stub,
      appendCommand({
        commandId: "7a9a3d09-9c92-44b6-8cf2-3c9820b25004",
        messageId: "search-two",
        body: "Budget review for Q3 is ready.",
      }),
    );

    const response = await stub.fetch(
      trustedRequest(
        "https://relay.test/internal/messages?after=0&limit=50&q=Budget",
      ),
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as { messages: Array<{ id: string }> };
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ id: "search-two" });
  });

  it("upserts durable agent activity with stable identity and cursor replay", async () => {
    const stub = conversationStub();
    const running = await postActivity(stub, {
      messageId: "activity-tool-1",
      threadRootId: "thread-root",
      component: {
        id: "tool-1",
        kind: "tool",
        version: 1,
        payload: {
          name: "relay_channels_list",
          status: "running",
          input: "{}",
          jobId: "job-1",
          runId: "run-1",
        },
      },
    });
    const completed = await postActivity(stub, {
      messageId: "activity-tool-1",
      threadRootId: "thread-root",
      component: {
        id: "tool-1",
        kind: "tool",
        version: 1,
        payload: {
          name: "relay_channels_list",
          status: "completed",
          input: "{}",
          output: '{"channels":[]}',
          jobId: "job-1",
          runId: "run-1",
        },
      },
    });

    expect(running.status).toBe(200);
    const runningResult = (await running.json()) as {
      created: boolean;
      message: { id: string; sequence: number };
    };
    expect(runningResult).toMatchObject({
      created: true,
      message: { id: "activity-tool-1" },
    });
    expect(completed.status).toBe(200);
    const completedResult = (await completed.json()) as {
      created: boolean;
      message: {
        id: string;
        sequence: number;
        components: Array<{ id: string; payload: { status: string } }>;
      };
    };
    expect(completedResult).toMatchObject({
      created: false,
      message: {
        id: "activity-tool-1",
        components: [{ id: "tool-1", payload: { status: "completed" } }],
      },
    });
    expect(completedResult.message.sequence).toBe(
      runningResult.message.sequence,
    );

    const page = await list(stub);
    expect(
      page.messages.filter((message) => message.id === "activity-tool-1"),
    ).toHaveLength(1);
    const replay = await listEvents(stub, runningResult.message.sequence);
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0]).toMatchObject({
      type: "conversation.message.edited",
      actor: { kind: "agent", agentId },
    });
    expect(replay.events[0]?.sequence).toBeGreaterThan(
      runningResult.message.sequence,
    );
  });

  it("rejects activity from users and identity-changing agent updates", async () => {
    const stub = conversationStub();
    const userWrite = await postActivity(
      stub,
      activityPayload("activity-protected", "tool-1"),
      false,
    );
    expect(userWrite.status).toBe(403);

    expect(
      (
        await postActivity(
          stub,
          activityPayload("activity-protected", "tool-1"),
        )
      ).status,
    ).toBe(200);
    const changedIdentity = await postActivity(
      stub,
      activityPayload("activity-protected", "tool-2"),
    );
    expect(changedIdentity.status).toBe(409);
    expect(await changedIdentity.json()).toMatchObject({
      error: { code: "activity_identity_mismatch" },
    });
    const otherAgent = await postActivity(
      stub,
      activityPayload("activity-protected", "tool-1"),
      true,
      "engineer",
    );
    expect(otherAgent.status).toBe(403);
    expect(await otherAgent.json()).toMatchObject({
      error: { code: "activity_owner_mismatch" },
    });
  });
});

function activityPayload(messageId: string, componentId: string) {
  return {
    messageId,
    component: {
      id: componentId,
      kind: "tool" as const,
      version: 1 as const,
      payload: { name: "relay_channels_list", status: "running" as const },
    },
  };
}

async function postActivity(
  stub: DurableObjectStub,
  input:
    | (ReturnType<typeof activityPayload> & { threadRootId?: string })
    | {
        messageId: string;
        threadRootId?: string;
        component: {
          id: string;
          kind: "tool";
          version: 1;
          payload: Record<string, string>;
        };
      },
  asAgent = true,
  actingAgentID = String(agentId),
) {
  const request = trustedRequest(
    `https://relay.test/internal/messages/${input.messageId}/activity`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, conversationId }),
    },
    asAgent,
    actingAgentID,
  );
  return stub.fetch(request);
}

function conversationStub(suffix = "") {
  const { CONVERSATIONS: conversations } = relayTestEnv();
  const id = conversations.idFromName(
    `${workspaceId}:${conversationId}${suffix}`,
  );
  return conversations.get(id);
}

function appendCommand(input: {
  commandId: string;
  messageId: string;
  routedConversationId?: string;
  threadRootId?: string;
  body?: string;
  components?: JsonObject[];
}) {
  return appendMessageCommandSchema.parse({
    commandId: input.commandId,
    protocolVersion: 1,
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload: {
      messageId: input.messageId,
      conversationId: input.routedConversationId ?? conversationId,
      threadRootId: input.threadRootId,
      body: input.body ?? "Hello from the durable relay.",
      components: input.components ?? [],
    },
  });
}

async function react(
  stub: DurableObjectStub,
  messageId: string,
  emoji: string,
  method: "POST" | "DELETE" = "POST",
) {
  const request = trustedRequest(
    `https://relay.test/internal/messages/${messageId}/reactions`,
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId, emoji }),
    },
  );
  return stub.fetch(request);
}

async function post(
  stub: DurableObjectStub,
  body: ReturnType<typeof appendCommand>,
  asAgent = false,
) {
  const request = trustedRequest(
    "https://relay.test/internal/messages",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    asAgent,
  );
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

async function listEvents(stub: DurableObjectStub, after = 0) {
  const response = await stub.fetch(
    trustedRequest(
      `https://relay.test/internal/events?after=${after}&limit=50`,
    ),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    events: Array<{
      sequence: number;
      type: string;
      actor: { kind: string; userId?: string; pubkey?: string };
    }>;
  };
}

function trustedRequest(
  url: string,
  init?: RequestInit,
  asAgent = false,
  actingAgentID = String(agentId),
) {
  return withTrustedContext(new Request(url, init), {
    principal: asAgent
      ? {
          kind: "agent",
          agentId: agentIdSchema.parse(actingAgentID),
          pubkey: hexKey(actingAgentID),
          workspaceId,
          role: "member",
        }
      : {
          kind: "user",
          userId,
          pubkey: hexKey(userId),
          workspaceId,
          role: "owner",
        },
    requestId: crypto.randomUUID(),
    workspaceId,
    conversationId,
  });
}
