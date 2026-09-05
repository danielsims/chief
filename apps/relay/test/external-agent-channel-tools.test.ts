import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appendConversationMessage,
  channelEnvelope,
  channelRpc,
  dispatchTestMessage,
  ownerId,
  setupChannelTest,
  testConversationMessages,
} from "./channel-test-helpers";
import {
  receiveExternalTool,
  registerExternalAgent,
  verifyExternalAgent,
} from "./external-agent-channel-helpers";

afterEach(() => vi.unstubAllGlobals());

describe("external agent channel tools", () => {
  it("lets Eve call Chief channel tools with the issued continuation", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-tools",
    });
    await verifyExternalAgent(ctx, "eve-tools");
    const direct = await channelRpc(
      ctx,
      ctx.principal,
      "directs-start",
      channelEnvelope({
        participant: { kind: "agent", principalId: "eve-tools" },
      }),
    );
    expect(direct.status).toBe(201);
    const conversationId = (
      (await direct.json()) as { conversation: { id: string } }
    ).conversation.id;
    const delivered: {
      current: {
        payload: {
          continuation: { capability: string };
          conversationId?: string;
          message: { id: string };
        };
      } | null;
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
          sessionId: "eve-tools-session",
        });
      }),
    );
    const triggerId = crypto.randomUUID();
    await appendConversationMessage(
      ctx,
      conversationId,
      "Please look at this.",
      triggerId,
    );
    await dispatchTestMessage(ctx, ctx.principal, {
      id: triggerId,
      workspaceId: ctx.workspaceId,
      conversationId,
      author: { kind: "user", id: ownerId },
      body: "Please look at this.",
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
    expect(delivered.current.payload.conversationId).toBe(conversationId);
    expect(delivered.current.payload.message.id).toBe(triggerId);
    const continuation = delivered.current.payload.continuation;
    const listed = await receiveExternalTool(
      ctx,
      "eve-tools",
      registered.channel.token,
      {
        deliveryId: triggerId,
        continuation,
        sessionId: "eve-tools-session",
        operationId: "channels.list",
        input: {},
      },
    );
    const reacted = await receiveExternalTool(
      ctx,
      "eve-tools",
      registered.channel.token,
      {
        deliveryId: triggerId,
        continuation,
        sessionId: "eve-tools-session",
        operationId: "channels.reactions.add",
        input: {
          channelId: conversationId,
          messageId: triggerId,
          emoji: "👀",
        },
      },
    );
    const posted = await receiveExternalTool(
      ctx,
      "eve-tools",
      registered.channel.token,
      {
        deliveryId: triggerId,
        continuation,
        sessionId: "eve-tools-session",
        operationId: "channels.messages.post",
        input: {
          channelId: conversationId,
          content: "I see it. What should we do next?",
        },
      },
    );

    expect(listed.status).toBe(200);
    expect(reacted.status).toBe(200);
    expect(posted.status).toBe(200);
    const listedBody = (await listed.json()) as {
      result: { channels: { id: string }[] };
    };
    expect(listedBody.result.channels.length).toBeGreaterThan(0);
    const messages = await testConversationMessages(
      ctx,
      ctx.principal,
      conversationId,
    );
    const trigger = messages.find((message) => message.id === triggerId);
    expect(trigger?.reactions).toEqual(
      expect.arrayContaining([expect.objectContaining({ emoji: "👀" })]),
    );
    expect(
      messages.some(
        (message) => message.body === "I see it. What should we do next?",
      ),
    ).toBe(true);
  });
});
