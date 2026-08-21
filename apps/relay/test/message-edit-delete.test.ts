import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  agentIdSchema,
  userIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";
import { hexKey } from "./helpers";

const workspaceId = workspaceIdSchema.parse("workspace-a");
const conversationId = "general";
const ownerId = userIdSchema.parse("user-a");
const memberId = userIdSchema.parse("user-b");
const agentId = agentIdSchema.parse("engineer");

describe("message edit and delete", () => {
  it("edits a message, marks it edited, and broadcasts the event", async () => {
    const stub = conversationStub();
    const appended = await append(stub, owner, "message-1", "Original text.");
    expect(appended.status).toBe(200);
    expect(await appended.json()).toMatchObject({
      message: { body: "Original text.", edited: false, deleted: false },
    });

    const edited = await edit(stub, owner, "message-1", "Revised text.");
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      message: { id: "message-1", body: "Revised text.", edited: true },
    });

    const events = await listEvents(stub);
    const editEvents = events.events.filter(
      (event) => event.type === "conversation.message.edited",
    );
    expect(editEvents).toHaveLength(1);
    expect(editEvents[0]).toMatchObject({
      type: "conversation.message.edited",
      payload: {
        message: { id: "message-1", body: "Revised text.", edited: true },
      },
    });
  });

  it("deletes a message with a tombstone and broadcasts the event", async () => {
    const stub = conversationStub();
    await append(stub, owner, "message-1", "Original text.");

    const deleted = await remove(stub, owner, "message-1");
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      message: {
        id: "message-1",
        body: "⚠️ This message was deleted.",
        deleted: true,
      },
    });

    const events = await listEvents(stub);
    const deleteEvents = events.events.filter(
      (event) => event.type === "conversation.message.deleted",
    );
    expect(deleteEvents).toHaveLength(1);
    expect(deleteEvents[0]).toMatchObject({
      type: "conversation.message.deleted",
      payload: { message: { id: "message-1", deleted: true } },
    });
  });

  it("rejects a non-author, non-owner edit or delete", async () => {
    const stub = conversationStub();
    await append(stub, owner, "message-1", "Owner's message.");
    await append(stub, member, "message-2", "Member's message.");

    const memberEditsOwners = await edit(
      stub,
      member,
      "message-1",
      "Tampered.",
    );
    expect(memberEditsOwners.status).toBe(403);
    expect(await memberEditsOwners.json()).toMatchObject({
      error: { code: "message_mutation_denied" },
    });

    const agentDeletesOwners = await remove(stub, agent, "message-1");
    expect(agentDeletesOwners.status).toBe(403);

    const ownerEditMemberOk = await edit(
      stub,
      owner,
      "message-2",
      "Owner edited member's message.",
    );
    expect(ownerEditMemberOk.status).toBe(200);
    expect(await ownerEditMemberOk.json()).toMatchObject({
      message: { id: "message-2", edited: true },
    });

    const memberDeletesOwn = await remove(stub, member, "message-2");
    expect(memberDeletesOwn.status).toBe(200);
  });
});

function conversationStub() {
  const conversations = (
    env as unknown as { CONVERSATIONS: DurableObjectNamespace }
  ).CONVERSATIONS;
  const id = conversations.idFromName(`${workspaceId}:${conversationId}`);
  return conversations.get(id);
}

async function append(
  stub: DurableObjectStub,
  principal: PrincipalLike,
  messageId: string,
  body: string,
) {
  const command = {
    commandId: crypto.randomUUID(),
    protocolVersion: 1,
    occurredAt: "2026-08-17T00:00:00.000Z",
    payload: {
      messageId,
      conversationId,
      body,
      components: [],
    },
  };
  return stub.fetch(
    trustedRequest("https://relay.test/internal/messages", principal, {
      method: "POST",
      body: JSON.stringify(command),
    }),
  );
}

async function edit(
  stub: DurableObjectStub,
  principal: PrincipalLike,
  messageId: string,
  body: string,
) {
  return stub.fetch(
    trustedRequest(
      `https://relay.test/internal/messages/${messageId}/edit`,
      principal,
      { method: "POST", body: JSON.stringify({ messageId, body }) },
    ),
  );
}

async function remove(
  stub: DurableObjectStub,
  principal: PrincipalLike,
  messageId: string,
) {
  return stub.fetch(
    trustedRequest(
      `https://relay.test/internal/messages/${messageId}`,
      principal,
      { method: "DELETE" },
    ),
  );
}

async function listEvents(stub: DurableObjectStub) {
  const response = await stub.fetch(
    trustedRequest(
      "https://relay.test/internal/events?after=0&limit=50",
      owner,
    ),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    events: Array<{
      type: string;
      payload: { message: Record<string, unknown> };
    }>;
  };
}

type PrincipalLike = Parameters<typeof withTrustedContext>[1]["principal"];

function trustedRequest(
  url: string,
  principal: PrincipalLike,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  const request = new Request(url, { ...init, headers });
  return withTrustedContext(request, {
    principal,
    requestId: crypto.randomUUID(),
    workspaceId,
    conversationId,
  });
}

const owner: PrincipalLike = {
  kind: "user",
  userId: ownerId,
  pubkey: hexKey(String(ownerId)),
  workspaceId,
  role: "owner",
};
const member: PrincipalLike = {
  kind: "user",
  userId: memberId,
  pubkey: hexKey(String(memberId)),
  workspaceId,
  role: "member",
};
const agent: PrincipalLike = {
  kind: "agent",
  agentId,
  pubkey: hexKey(agentId),
  workspaceId,
  role: "member",
};
