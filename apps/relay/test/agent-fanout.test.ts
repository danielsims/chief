import { describe, expect, it } from "vitest";

import { channelIdForKey } from "../src/hosted-agent-tools/toolkits/channels";

describe("agent fan-out integrity", () => {
  it("derives a stable channel id from an operationKey", async () => {
    const first = await channelIdForKey("marketing-channel");
    const second = await channelIdForKey("marketing-channel");
    expect(first).toBe(second);
    expect(first).toMatch(/^channel-[0-9a-f]{24}$/u);
  });

  it("derives distinct channel ids for distinct operation keys", async () => {
    const marketing = await channelIdForKey("marketing-channel");
    const engineering = await channelIdForKey("engineering-channel");
    expect(marketing).not.toBe(engineering);
  });
});
