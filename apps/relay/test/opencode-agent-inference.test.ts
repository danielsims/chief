import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { runPortableAgentTurn } from "@chief/agent-runtime/portable-agent-runner";

import { OpenCodeAgentInference } from "../src/opencode-agent-inference";

const requestSchema = z.object({
  model: z.literal("deepseek-v4-flash"),
  messages: z.array(z.object({ role: z.string() }).passthrough()),
  tools: z.array(z.object({ type: z.literal("function") }).passthrough()),
});

describe("OpenCodeAgentInference", () => {
  const liveApiKey = z
    .object({ OPENCODE_API_KEY: z.string().optional() })
    .parse(env).OPENCODE_API_KEY;

  it("sends DeepSeek V4 Flash through the OpenCode Go API", async () => {
    let requestBody: unknown;
    const request = async function (
      this: void,
      _input: string | URL | Request,
      init?: RequestInit,
    ) {
      expect(this).toBeUndefined();
      requestBody = JSON.parse(z.string().parse(init?.body));
      return Response.json({
        choices: [{ message: { content: "ready", tool_calls: [] } }],
      });
    };
    const inference = new OpenCodeAgentInference("test-key", request);

    const result = await inference.complete({
      messages: [{ role: "user", content: "Say ready." }],
      tools: [],
      maxTokens: 120,
      temperature: 0,
    });

    expect(requestSchema.parse(requestBody)).toMatchObject({
      model: "deepseek-v4-flash",
    });
    expect(result).toEqual({ content: "ready", toolCalls: [] });
  });

  it("accepts a null tool_calls field from the Go API", async () => {
    const request = async function (
      this: void,
      _input: string | URL | Request,
      _init?: RequestInit,
    ) {
      expect(this).toBeUndefined();
      return Response.json({
        choices: [{ message: { content: "ok", tool_calls: null } }],
      });
    };
    const inference = new OpenCodeAgentInference("test-key", request);

    const result = await inference.complete({
      messages: [{ role: "user", content: "Hi." }],
      tools: [],
      maxTokens: 120,
      temperature: 0,
    });

    expect(result).toEqual({ content: "ok", toolCalls: [] });
  });

  it.skipIf(!liveApiKey || liveApiKey === "test")(
    "completes a live model-to-tool-to-model round",
    async () => {
      if (!liveApiKey) throw new Error("OpenCode Go is not configured.");
      const inference = new OpenCodeAgentInference(liveApiKey);
      const reply = await runPortableAgentTurn({
        inference,
        messages: [
          {
            role: "user",
            content:
              "Call read_file for /workspace/brief.md, then reply with only its content.",
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
        execute: () => Promise.resolve({ content: "chief-runtime-ready" }),
        maxRounds: 3,
        maxTokens: 300,
        temperature: 0,
      });

      expect(reply).toContain("chief-runtime-ready");
    },
  );
});
