import { describe, expect, it } from "vitest";

import { normalizeHostedToolArguments } from "../src/hosted-agent-tools";

describe("hosted agent tool input", () => {
  it("normalizes a single message mention without weakening the command schema", () => {
    expect(
      normalizeHostedToolArguments("channels_messages_post", {
        channelId: "mission-control",
        content: "Hey @Marketer",
        mentions: "brand",
      }),
    ).toEqual({
      channelId: "mission-control",
      content: "Hey @Marketer",
      mentions: ["brand"],
    });
  });

  it("does not rewrite unrelated tool arguments", () => {
    const input = { members: "brand" };
    expect(normalizeHostedToolArguments("channels_members_add", input)).toBe(
      input,
    );
  });
});
