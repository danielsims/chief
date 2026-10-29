import { describe, expect, it } from "vitest";

import {
  extractTextToolCalls,
  hasTextToolCallMarkup,
} from "../src/inference-text-tool-calls";

const token = "｜｜DSML｜｜";

describe("extractTextToolCalls", () => {
  it("recovers the token-form calls DeepSeek writes as text", () => {
    const text = `On it.\n<${token} calls>\n<${token} invoke name="channels_messages_list">\n<${token} parameter name="channelId" string="true">channel-a</${token} parameter>\n<${token} parameter name="limit" string="false">50</${token} parameter>\n</${token} invoke>\n</${token} calls>`;
    expect(hasTextToolCallMarkup(text)).toBe(true);
    const result = extractTextToolCalls(text);
    expect(result.calls).toEqual([
      {
        name: "channels_messages_list",
        arguments: { channelId: "channel-a", limit: 50 },
      },
    ]);
    expect(result.text).toBe("On it.");
  });

  it("still recovers the DSML spelling", () => {
    const text = `<｜DSML｜tool_calls><｜DSML｜invoke name="web_read"><｜DSML｜parameter name="url" string="true">https://example.com</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>`;
    const result = extractTextToolCalls(text);
    expect(result.calls).toEqual([
      { name: "web_read", arguments: { url: "https://example.com" } },
    ]);
    expect(result.text).toBe("");
  });
});
