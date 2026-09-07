import { expect, it, vi } from "vitest";

import { deliverConversationSocketEvent } from "../src/conversation-socket-delivery";
import {
  agentId,
  channelEnvelope,
  channelRpc,
  registerTestAgent,
  setupChannelTest,
  testAgentPrincipal,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

it("rechecks private-channel membership before delivering to an existing socket", async () => {
  const ctx = await setupChannelTest();
  const pubkey = hexKey("socket-reader");
  await registerTestAgent(ctx, agentId, pubkey);
  const principal = testAgentPrincipal(ctx, agentId, pubkey);
  await channelRpc(
    ctx,
    ctx.principal,
    "channels-create",
    channelEnvelope({
      conversationId: "private-stream",
      name: "private-stream",
      isPrivate: true,
    }),
  );
  await channelRpc(
    ctx,
    ctx.principal,
    "channels-members-add",
    channelEnvelope({
      conversationId: "private-stream",
      kind: "agent",
      principalId: agentId,
    }),
  );
  const send = vi.fn();
  const close = vi.fn();
  const socket = {
    send,
    close,
    deserializeAttachment: () => ({
      principal,
      workspaceId: ctx.workspaceId,
      conversationId: "private-stream",
    }),
  };
  await deliverConversationSocketEvent(ctx.env, [socket], {
    text: "Before removal",
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  const removed = await channelRpc(
    ctx,
    ctx.principal,
    "channels-members-remove",
    channelEnvelope({
      conversationId: "private-stream",
      kind: "agent",
      principalId: agentId,
    }),
  );
  expect(removed.status).toBe(200);
  await deliverConversationSocketEvent(ctx.env, [socket], {
    text: "Private after removal",
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledWith(1008, expect.any(String));
});

it("closes legacy sockets without an identity attachment", async () => {
  const ctx = await setupChannelTest();
  const send = vi.fn();
  const close = vi.fn();
  const socket = {
    send,
    close,
    deserializeAttachment: () => null,
  };
  await deliverConversationSocketEvent(ctx.env, [socket], { text: "Private" });
  expect(send).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledWith(1008, expect.any(String));
});
