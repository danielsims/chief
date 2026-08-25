import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { CloudflareAgentInference } from "../src/cloudflare-agent-inference";

describe("CloudflareAgentInference", () => {
  it("returns a real hosted response through the vendor-neutral adapter", async () => {
    const inference = new CloudflareAgentInference(
      env.AI,
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    );

    const result = await inference.complete({
      messages: [
        {
          role: "user",
          content: "Reply with only the word ready.",
        },
      ],
      tools: [],
      maxTokens: 20,
      temperature: 0,
    });

    expect(result.content?.toLowerCase()).toContain("ready");
    expect(result.toolCalls).toEqual([]);
  });

  it("normalizes a real Workers AI tool call", async () => {
    const inference = new CloudflareAgentInference(
      env.AI,
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    );

    const result = await inference.complete({
      messages: [
        {
          role: "user",
          content: "Use read_file to read /workspace/brief.md now.",
        },
      ],
      tools: [
        {
          name: "read_file",
          description: "Read a text file.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
      maxTokens: 100,
      temperature: 0,
    });

    expect(result.toolCalls).toEqual([
      expect.objectContaining({ name: "read_file" }),
    ]);
  });
});
