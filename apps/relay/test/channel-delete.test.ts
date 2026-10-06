import { describe, expect, it } from "vitest";

import {
  activeTestSnapshot,
  agentId,
  channelEnvelope,
  channelRpc,
  registerTestAgent,
  setupChannelTest,
  testAgentPrincipal,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

describe("channel deletion", () => {
  it("lets an owner delete a channel for good", async () => {
    const ctx = await setupChannelTest();
    await channelRpc(
      ctx,
      ctx.principal,
      "channels-create",
      channelEnvelope({ conversationId: "doomed", name: "Doomed" }),
    );
    const deleted = await channelRpc(
      ctx,
      ctx.principal,
      "channels-delete",
      channelEnvelope({ conversationId: "doomed" }),
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      deleted: true,
      conversationId: "doomed",
    });

    const listed = await channelRpc(ctx, ctx.principal, "channels-list");
    const { channels } = (await listed.json()) as {
      channels: { id: string }[];
    };
    expect(channels.map((channel) => channel.id)).not.toContain("doomed");
    const snapshot = await activeTestSnapshot(ctx);
    expect(snapshot.conversations.map((item) => item.id)).not.toContain(
      "doomed",
    );
  });

  it("protects #general and refuses agents", async () => {
    const ctx = await setupChannelTest();
    const general = await channelRpc(
      ctx,
      ctx.principal,
      "channels-delete",
      channelEnvelope({ conversationId: "general" }),
    );
    expect(general.status).toBe(409);

    const pubkey = hexKey(String(agentId));
    await registerTestAgent(ctx, agentId, pubkey);
    await channelRpc(
      ctx,
      ctx.principal,
      "channels-create",
      channelEnvelope({ conversationId: "kept", name: "Kept" }),
    );
    const byAgent = await channelRpc(
      ctx,
      testAgentPrincipal(ctx, agentId, pubkey),
      "channels-delete",
      channelEnvelope({ conversationId: "kept" }),
    );
    expect(byAgent.status).toBe(403);
  });
});
