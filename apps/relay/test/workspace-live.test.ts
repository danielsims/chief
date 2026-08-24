import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  withTrustedContext,
  withTrustedWorkspaceSocketTicket,
} from "../src/internal-context";
import { channelRpc, setupChannelTest } from "./channel-test-helpers";

describe("workspace live delivery", () => {
  it("issues one-time tickets from the durable cursor", async () => {
    const ctx = await setupChannelTest();
    const firstTicketResponse = await channelRpc(
      ctx,
      ctx.principal,
      "live-socket-ticket",
    );
    const firstTicket = (await firstTicketResponse.json()) as {
      ticket: string;
      cursor: number;
    };
    expect(firstTicketResponse.status).toBe(201);
    expect(firstTicket.cursor).toBe(0);

    const published = await liveEventRpc(
      ctx,
      conversationEvent(ctx.workspaceId, "general"),
      "general",
    );
    expect(published.status).toBe(200);
    expect(await published.json()).toEqual({ sequence: 1 });

    const nextTicket = await channelRpc(
      ctx,
      ctx.principal,
      "live-socket-ticket",
    );
    expect(await nextTicket.json()).toMatchObject({ cursor: 1 });

    const connect = () =>
      workspaceStub(ctx.workspaceId).fetch(
        withTrustedWorkspaceSocketTicket(
          new Request("https://relay.test/v1/connect"),
          {
            ticket: firstTicket.ticket,
            requestId: crypto.randomUUID(),
            workspaceId: ctx.workspaceId,
          },
        ),
      );
    expect((await connect()).status).toBe(101);
    const replayed = await connect();
    expect(replayed.status).toBe(401);
    expect(await replayed.json()).toMatchObject({
      error: { code: "invalid_socket_ticket" },
    });
  });

  it("rejects events that do not match their trusted conversation scope", async () => {
    const ctx = await setupChannelTest();
    const response = await liveEventRpc(
      ctx,
      conversationEvent(ctx.workspaceId, "engineering"),
      "general",
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "live_event_scope_mismatch" },
    });
  });
});

function workspaceStub(workspaceId: string) {
  const workspaces = (env as unknown as { WORKSPACES: DurableObjectNamespace })
    .WORKSPACES;
  return workspaces.get(workspaces.idFromName(workspaceId));
}

function liveEventRpc(
  ctx: Awaited<ReturnType<typeof setupChannelTest>>,
  event: ReturnType<typeof conversationEvent>,
  conversationId: string,
) {
  return workspaceStub(ctx.workspaceId).fetch(
    withTrustedContext(
      new Request("https://workspace.internal/live-events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "live-event-publish",
        },
        body: JSON.stringify(event),
      }),
      {
        principal: ctx.principal,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        conversationId,
      },
    ),
  );
}

function conversationEvent(workspaceId: string, conversationId: string) {
  return {
    eventId: crypto.randomUUID(),
    sequence: 1,
    protocolVersion: 1,
    workspaceId,
    streamId: `conversation:${conversationId}`,
    type: "conversation.message.appended",
    actor: {
      kind: "user",
      userId: "channel-owner",
      pubkey: "a".repeat(64),
      workspaceId,
      role: "owner",
    },
    occurredAt: "2026-08-21T00:00:00.000Z",
    payload: {
      message: {
        id: crypto.randomUUID(),
        workspaceId,
        conversationId,
        body: "Hello from the workspace live journal.",
        author: { kind: "user", id: "channel-owner" },
        createdAt: "2026-08-21T00:00:00.000Z",
        sequence: 1,
        mentions: [],
        components: [],
        reactions: [],
        edited: false,
        deleted: false,
      },
    },
  };
}
