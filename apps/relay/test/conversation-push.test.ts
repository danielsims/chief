import { describe, expect, it } from "vitest";

import { conversationMessageSchema } from "@chief/relay-contracts";

import { conversationPushAlerts } from "../src/conversation-push";

function message(body: string, mentions: string[] = []) {
  return conversationMessageSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId: "workspace-a",
    conversationId: "marketing",
    author: { kind: "agent", id: "brand" },
    body,
    mentions,
    components: [],
    reactions: [],
    edited: false,
    deleted: false,
    createdAt: "2026-09-04T05:12:00.000Z",
    sequence: 2,
  });
}

describe("conversation push mentions", () => {
  const daniel = { id: "user-daniel", name: "Daniel Sims" };

  it("titles an explicit @name as a mention even without a structured id", () => {
    const alerts = conversationPushAlerts(
      message("Hey @Daniel Sims, first brand profile is done"),
      [daniel],
    );
    expect(alerts).toEqual([
      {
        userId: "user-daniel",
        mentioned: true,
        title: "Marketer mentioned you in #marketing",
      },
    ]);
  });

  it("keeps ordinary channel messages on the generic title", () => {
    const alerts = conversationPushAlerts(message("Getting oriented now."), [
      daniel,
    ]);
    expect(alerts).toEqual([
      {
        userId: "user-daniel",
        mentioned: false,
        title: "Marketer in #marketing",
      },
    ]);
  });
});
