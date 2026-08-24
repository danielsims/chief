import { describe, expect, it } from "vitest";

import { agentIdSchema } from "@chief/relay-contracts";

import {
  activeTestSnapshot,
  channelRpc,
  registerTestAgent,
  setupChannelTest,
  testConversationMessages,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

describe("channel membership batches", () => {
  it("adds several agents atomically and publishes one natural channel event", async () => {
    const ctx = await setupChannelTest();
    const agents = ["brand", "prospector", "engineer"].map((value) =>
      agentIdSchema.parse(value),
    );
    for (const agent of agents) {
      await registerTestAgent(ctx, agent, hexKey(`batch-${agent}`));
    }

    const response = await channelRpc(
      ctx,
      ctx.principal,
      "channels-members-add",
      {
        commandId: crypto.randomUUID(),
        protocolVersion: 1,
        occurredAt: new Date().toISOString(),
        payload: {
          conversationId: "mission-control",
          members: agents.map((principalId) => ({
            kind: "agent" as const,
            principalId,
          })),
        },
      },
    );
    expect(response.status).toBe(200);

    const messages = await testConversationMessages(
      ctx,
      ctx.principal,
      "mission-control",
    );
    const events = messages.filter((message) =>
      message.components.some(
        (component) => component.payload.type === "member-added",
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      body: "You added Marketer, Prospector, and Engineer to the channel.",
      components: [
        expect.objectContaining({
          payload: expect.objectContaining({
            targetIds: "brand,prospector,engineer",
            targetNames: "Marketer,Prospector,Engineer",
          }),
        }),
      ],
    });

    const snapshot = await activeTestSnapshot(ctx);
    expect(
      snapshot.conversations.find((item) => item.id === "mission-control"),
    ).toMatchObject({ isPrivate: false });
  });
});
