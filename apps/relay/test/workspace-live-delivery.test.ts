import { describe, expect, it } from "vitest";

import {
  conversationEventSchema,
  principalSchema,
} from "@chief/relay-contracts";

import { isMembershipGrantForPrincipal } from "../src/workspace-live-delivery";

describe("workspace live membership delivery", () => {
  it("targets every invited user in a batched membership event", () => {
    const event = conversationEventSchema.parse({
      eventId: crypto.randomUUID(),
      sequence: 1,
      protocolVersion: 1,
      workspaceId: "workspace-test",
      streamId: "conversation:new-channel",
      type: "conversation.message.appended",
      actor: {
        kind: "user",
        userId: "owner",
        pubkey: "a".repeat(64),
        workspaceId: "workspace-test",
        role: "owner",
      },
      occurredAt: "2026-08-28T00:00:00.000Z",
      payload: {
        message: {
          id: crypto.randomUUID(),
          workspaceId: "workspace-test",
          conversationId: "new-channel",
          body: "Daniel and Alex were added to the channel.",
          author: { kind: "system", id: "relay" },
          createdAt: "2026-08-28T00:00:00.000Z",
          sequence: 1,
          mentions: [],
          components: [
            {
              id: crypto.randomUUID(),
              kind: "channel-action",
              version: 1,
              payload: {
                type: "member-added",
                actorId: "owner",
                actorName: "Owner",
                actorType: "user",
                targetId: "user-daniel",
                targetKind: "user",
                targetName: "Daniel",
                targetIds: "user-daniel,user-alex",
                targetNames: "Daniel,Alex",
                agentIds: "",
                userIds: "user-daniel,user-alex",
              },
            },
          ],
          reactions: [],
          edited: false,
          deleted: false,
        },
      },
    });
    const principal = (userId: string) =>
      principalSchema.parse({
        kind: "user",
        userId,
        pubkey: "b".repeat(64),
        workspaceId: "workspace-test",
        role: "member",
      });

    expect(isMembershipGrantForPrincipal(event, principal("user-daniel"))).toBe(
      true,
    );
    expect(isMembershipGrantForPrincipal(event, principal("user-alex"))).toBe(
      true,
    );
    expect(isMembershipGrantForPrincipal(event, principal("user-other"))).toBe(
      false,
    );
  });
});
