import { afterEach, describe, expect, it, vi } from "vitest";

import { agentIdSchema } from "@chief/relay-contracts";

import {
  activeTestSnapshot,
  appendRootMessage,
  channelEnvelope,
  channelRpc,
  dispatchTestMessage,
  ownerId,
  setupChannelTest,
  testConversationMessages,
} from "./channel-test-helpers";
import {
  receiveExternalActivity,
  receiveExternalAgent,
  registerExternalAgent,
  verifyExternalAgent,
  workspaceFetch,
} from "./external-agent-channel-helpers";

afterEach(() => vi.unstubAllGlobals());

describe("external agent channel inbound", () => {
  it("resumes an unverified native-to-Eve migration without replacing its credentials", async () => {
    const ctx = await setupChannelTest();
    const first = await registerExternalAgent(ctx, {
      agentId: "chief",
      replaceNative: true,
    });
    const resumed = await registerExternalAgent(ctx, {
      agentId: "chief",
      endpoint: "https://chief-retry.vercel.app/channels/chief/messages",
      replaceNative: true,
    });

    expect(resumed.channel.token).toBe(first.channel.token);
    expect((await activeTestSnapshot(ctx)).agents).toContainEqual(
      expect.objectContaining({
        id: "chief",
        runtime: { kind: "native-cell" },
      }),
    );
  });

  it("atomically rotates an external channel credential", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-rotated",
    });
    const response = await workspaceFetch(
      ctx,
      "external-agent-rotate",
      {},
      ctx.principal,
      `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/eve-rotated/external/credentials/rotate`,
    );
    expect(response.status).toBe(200);
    const rotated = (await response.json()) as {
      channel: {
        token: string;
        inboundUrl: string;
        deliverySigningKeyId: string;
        deliverySigningSecret: string;
      };
    };
    expect(rotated.channel.token).not.toBe(registered.channel.token);
    expect(rotated.channel.inboundUrl).toBe(registered.channel.inboundUrl);
    expect(rotated.channel.deliverySigningKeyId).not.toBe(
      registered.channel.deliverySigningKeyId,
    );
    expect(rotated.channel.deliverySigningSecret).not.toBe(
      registered.channel.deliverySigningSecret,
    );
    expect(registered.channel.deliverySigningKeyId).toMatch(/^dsk_/u);
    expect(registered.channel.deliverySigningSecret).toHaveLength(43);

    const oldCredential = await receiveExternalAgent(
      ctx,
      "eve-rotated",
      registered.channel.token,
      {
        deliveryId: "delivery-after-rotation",
        continuation: {
          capability:
            "invalid-capability-that-is-long-enough-to-pass-the-schema-0001",
        },
        sessionId: "eve-session",
        body: "This credential is obsolete.",
      },
    );
    expect(oldCredential.status).toBe(401);
  });

  it("routes dead-letter requeue through an authenticated workspace administrator", async () => {
    const ctx = await setupChannelTest();
    const response = await workspaceFetch(
      ctx,
      "external-agent-requeue",
      {},
      ctx.principal,
      `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/eve/channel/deliveries/delivery-1/requeue`,
    );
    expect(response.status).toBe(404);
  });

  it("continues the issued thread once and deduplicates the inbound delivery", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-threaded",
    });
    await verifyExternalAgent(ctx, "eve-threaded");
    const rootId = await appendRootMessage(ctx);
    const delivered: {
      current: { payload: { continuation: { capability: string } } } | null;
    } = { current: null };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        delivered.current = (await new Request(
          input,
          init,
        ).json()) as NonNullable<typeof delivered.current>;
        return Response.json({
          status: "accepted",
          sessionId: "eve-thread-session",
        });
      }),
    );
    const triggerId = crypto.randomUUID();
    await dispatchTestMessage(ctx, ctx.principal, {
      id: triggerId,
      workspaceId: ctx.workspaceId,
      conversationId: "mission-control",
      threadRootId: rootId,
      author: { kind: "user", id: ownerId },
      body: "@Eve Threaded continue here.",
      mentions: [agentIdSchema.parse("eve-threaded")],
      components: [],
      reactions: [],
      edited: false,
      deleted: false,
      createdAt: new Date().toISOString(),
      sequence: 2,
    });
    await vi.waitFor(() => expect(delivered.current).not.toBeNull());
    if (!delivered.current) throw new Error("Expected an external delivery.");
    const inbound = {
      deliveryId: crypto.randomUUID(),
      continuation: delivered.current.payload.continuation,
      sessionId: "eve-thread-session",
      body: "Threaded result from Eve.",
    };
    const accepted = await receiveExternalAgent(
      ctx,
      "eve-threaded",
      registered.channel.token,
      inbound,
    );
    const duplicate = await receiveExternalAgent(
      ctx,
      "eve-threaded",
      registered.channel.token,
      inbound,
    );

    expect(accepted.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ duplicate: true });
    const messages = await testConversationMessages(
      ctx,
      ctx.principal,
      "mission-control",
    );
    expect(
      messages.filter((message) => message.body === inbound.body),
    ).toHaveLength(1);
  });

  it("streams Eve activity into one stable conversation message", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-streaming",
    });
    await verifyExternalAgent(ctx, "eve-streaming");
    const delivered: {
      current: { payload: { continuation: { capability: string } } } | null;
    } = { current: null };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        delivered.current = (await new Request(
          input,
          init,
        ).json()) as NonNullable<typeof delivered.current>;
        return Response.json({
          status: "accepted",
          sessionId: "eve-stream-session",
        });
      }),
    );
    await dispatchTestMessage(ctx, ctx.principal, {
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      conversationId: "mission-control",
      author: { kind: "user", id: ownerId },
      body: "@Eve Streaming inspect this.",
      mentions: [agentIdSchema.parse("eve-streaming")],
      components: [],
      reactions: [],
      edited: false,
      deleted: false,
      createdAt: new Date().toISOString(),
      sequence: 1,
    });
    await vi.waitFor(() => expect(delivered.current).not.toBeNull());
    if (!delivered.current) throw new Error("Expected an external delivery.");
    const baseActivity = {
      deliveryId: crypto.randomUUID(),
      continuation: delivered.current.payload.continuation,
      sessionId: "eve-stream-session",
      component: {
        id: "reasoning:turn-1:0",
        kind: "thinking" as const,
        version: 1 as const,
        payload: {
          text: "Inspecting",
          status: "working" as const,
          providerSessionId: "eve-stream-session",
        },
      },
    };

    const working = await receiveExternalActivity(
      ctx,
      "eve-streaming",
      registered.channel.token,
      baseActivity,
    );
    const completed = await receiveExternalActivity(
      ctx,
      "eve-streaming",
      registered.channel.token,
      {
        ...baseActivity,
        component: {
          ...baseActivity.component,
          payload: {
            ...baseActivity.component.payload,
            text: "Inspecting the workspace.",
            status: "completed",
          },
        },
      },
    );

    expect(working.status).toBe(200);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual(await working.json());
    const messages = await testConversationMessages(
      ctx,
      ctx.principal,
      "mission-control",
    );
    const activityMessages = messages.filter(
      (message) => message.author.id === "eve-streaming" && !message.body,
    );
    expect(activityMessages).toHaveLength(1);
    expect(activityMessages[0]?.components).toEqual([
      expect.objectContaining({
        kind: "thinking",
        payload: expect.objectContaining({
          text: "Inspecting the workspace.",
          status: "completed",
        }),
      }),
    ]);
  });

  it("appends a visible Eve reply in a direct message after thinking activity", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-dm",
    });
    await verifyExternalAgent(ctx, "eve-dm");
    const direct = await channelRpc(
      ctx,
      ctx.principal,
      "directs-start",
      channelEnvelope({
        participant: { kind: "agent", principalId: "eve-dm" },
      }),
    );
    expect(direct.status).toBe(201);
    const conversationId = (
      (await direct.json()) as { conversation: { id: string } }
    ).conversation.id;
    const delivered: {
      current: { payload: { continuation: { capability: string } } } | null;
    } = { current: null };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        delivered.current = (await new Request(
          input,
          init,
        ).json()) as NonNullable<typeof delivered.current>;
        return Response.json({
          status: "accepted",
          sessionId: "eve-dm-session",
        });
      }),
    );
    const triggerId = crypto.randomUUID();
    await dispatchTestMessage(ctx, ctx.principal, {
      id: triggerId,
      workspaceId: ctx.workspaceId,
      conversationId,
      author: { kind: "user", id: ownerId },
      body: "Hello Chief.",
      mentions: [],
      components: [],
      reactions: [],
      edited: false,
      deleted: false,
      createdAt: new Date().toISOString(),
      sequence: 1,
    });
    await vi.waitFor(() => expect(delivered.current).not.toBeNull());
    if (!delivered.current) throw new Error("Expected an external delivery.");
    const continuation = delivered.current.payload.continuation;
    const thinking = await receiveExternalActivity(
      ctx,
      "eve-dm",
      registered.channel.token,
      {
        deliveryId: triggerId,
        continuation,
        sessionId: "eve-dm-session",
        component: {
          id: "reasoning:turn-1:0",
          kind: "thinking",
          version: 1,
          payload: {
            text: "Composing a greeting.",
            status: "completed",
            providerSessionId: "eve-dm-session",
          },
        },
      },
    );
    const inbound = {
      deliveryId: `${triggerId}:turn_1`,
      continuation,
      sessionId: "eve-dm-session",
      body: "Hello. What should we work on first?",
    };
    const accepted = await receiveExternalAgent(
      ctx,
      "eve-dm",
      registered.channel.token,
      inbound,
    );

    expect(thinking.status).toBe(200);
    expect(accepted.status).toBe(200);
    const messages = await testConversationMessages(
      ctx,
      ctx.principal,
      conversationId,
    );
    expect(
      messages.filter((message) => message.body === inbound.body),
    ).toHaveLength(1);
    expect(
      messages.find((message) => message.body === inbound.body)?.threadRootId,
    ).toBeUndefined();
  });
});
