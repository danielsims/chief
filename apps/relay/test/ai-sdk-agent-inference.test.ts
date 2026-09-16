import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MemoryCellPersistence } from "@chief/agent-runtime/cells/memory";
import { DurableTurnRunner } from "@chief/agent-runtime/durable-turn";

import { AiSdkAgentInference } from "../src/ai-sdk-agent-inference";
import { traceContext } from "./ai-sdk-agent-inference-harness";

const requestSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({ role: z.string() }).passthrough()),
  tools: z
    .array(z.object({ type: z.literal("function") }).passthrough())
    .optional(),
});

describe("AiSdkAgentInference", () => {
  const liveApiKey = z
    .object({ OPENCODE_API_KEY: z.string().optional() })
    .parse(env).OPENCODE_API_KEY;

  it("sends DeepSeek V4 Flash through the OpenCode Go API", async () => {
    let requestBody: unknown;
    let requestSignal: AbortSignal | null | undefined;
    const request = async function (
      this: void,
      _input: string | URL | Request,
      init?: RequestInit,
    ) {
      expect(this).toBeUndefined();
      requestBody = JSON.parse(z.string().parse(init?.body));
      requestSignal = init?.signal;
      return Response.json({
        choices: [{ message: { content: "ready", tool_calls: [] } }],
      });
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );

    const result = await inference.complete({
      messages: [
        { role: "system", content: "Answer concisely." },
        { role: "user", content: "Say ready." },
      ],
      tools: [
        {
          name: "read_status",
          description: "Read the current status.",
          parameters: { type: "object", properties: {} },
        },
      ],
      maxTokens: 120,
      temperature: 0,
    });

    expect(requestSchema.parse(requestBody)).toMatchObject({
      model: "deepseek-v4-flash",
      messages: [{ role: "system" }, { role: "user" }],
    });
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(requestSignal?.aborted).toBe(false);
    expect(result).toEqual({ content: "ready", toolCalls: [] });
  });

  it("identifies hosted OpenCode traffic with a coding-agent user agent and session", async () => {
    let requestHeaders = new Headers();
    const request = async function (
      this: void,
      _input: string | URL | Request,
      init?: RequestInit,
    ) {
      expect(this).toBeUndefined();
      requestHeaders = new Headers(init?.headers);
      return Response.json({
        choices: [{ message: { content: "ready", tool_calls: [] } }],
      });
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );

    await inference.complete({
      messages: [{ role: "user", content: "Say ready." }],
      tools: [],
      maxTokens: 120,
      temperature: 0,
    });

    expect(requestHeaders.get("user-agent")).toBe(
      "Chief/1.0 (+https://heychief.sh)",
    );
    expect(requestHeaders.get("x-opencode-session")).toBe(
      "workspace-test:engineer:engineering",
    );
    expect(requestHeaders.get("authorization")).toBe("Bearer test-key");
  });

  it("surfaces an empty OpenCode error body as an HTTP status failure", async () => {
    const request = async function (this: void) {
      expect(this).toBeUndefined();
      return new Response("", { status: 403 });
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );

    await expect(
      inference.complete({
        messages: [{ role: "user", content: "Hi." }],
        tools: [],
        maxTokens: 120,
        temperature: 0,
      }),
    ).rejects.toThrow(/HTTP 403 with an empty body/);
  });

  it("surfaces OpenCode RegionError JSON that is not a bare OpenAI error envelope", async () => {
    const request = async function (this: void) {
      expect(this).toBeUndefined();
      return Response.json(
        {
          type: "error",
          error: {
            type: "RegionError",
            message:
              "The latest version of this model is only available hosted in China and requires explicit opt in.",
          },
        },
        { status: 403 },
      );
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );

    await expect(
      inference.complete({
        messages: [{ role: "user", content: "Hi." }],
        tools: [],
        maxTokens: 120,
        temperature: 0,
      }),
    ).rejects.toThrow(/requires explicit opt in/);
  });

  it("leaves retries to the durable cell boundary", async () => {
    let attempts = 0;
    const request = async function (this: void) {
      expect(this).toBeUndefined();
      attempts += 1;
      throw new Error("provider unavailable");
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );

    await expect(
      inference.complete({
        messages: [{ role: "user", content: "Hi." }],
        tools: [],
        maxTokens: 120,
        temperature: 0,
      }),
    ).rejects.toThrow("provider unavailable");
    expect(attempts).toBe(1);
  });

  it("sends the selected OpenCode Go model", async () => {
    let requestBody: unknown;
    const request = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestBody = JSON.parse(z.string().parse(init?.body));
      return Response.json({
        choices: [{ message: { content: "ready", tool_calls: [] } }],
      });
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
      {
        provider: "opencode",
        model: "opencode-go/glm-5.3",
        secretRef: "opencode",
      },
    );

    await inference.complete({
      messages: [{ role: "user", content: "Say ready." }],
      tools: [],
      maxTokens: 120,
      temperature: 0,
    });

    expect(requestSchema.parse(requestBody).model).toBe("glm-5.3");
  });

  it("sends DeepSeek V4 Flash through the native Vercel AI Gateway provider", async () => {
    let requestUrl = "";
    let requestHeaders = new Headers();
    const request = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestUrl = input instanceof Request ? input.url : input.toString();
      requestHeaders = new Headers(init?.headers);
      return Response.json({
        content: [{ type: "text", text: "ready" }],
        finishReason: "stop",
        usage: {
          inputTokens: { total: 1 },
          outputTokens: { total: 1 },
        },
      });
    };
    const inference = new AiSdkAgentInference(
      "test-vercel-key",
      traceContext(),
      request,
      {
        provider: "vercel-ai-gateway",
        model: "deepseek/deepseek-v4-flash",
        secretRef: "vercel-ai-gateway",
      },
    );

    const result = await inference.complete({
      messages: [{ role: "user", content: "Say ready." }],
      tools: [],
      maxTokens: 120,
      temperature: 0,
    });

    expect(requestUrl).toBe(
      "https://ai-gateway.vercel.sh/v4/ai/language-model",
    );
    expect(requestHeaders.get("authorization")).toBe("Bearer test-vercel-key");
    expect(requestHeaders.get("ai-language-model-id")).toBe(
      "deepseek/deepseek-v4-flash",
    );
    expect(result).toEqual({ content: "ready", toolCalls: [] });
  });

  it("passes every durable system message through AI SDK instructions", async () => {
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
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );

    await inference.complete({
      messages: [
        { role: "system", content: "Base instructions." },
        { role: "user", content: "Create the channel." },
        { role: "system", content: "Finish the required tool call first." },
      ],
      tools: [],
      maxTokens: 120,
      temperature: 0,
    });

    expect(requestSchema.parse(requestBody).messages).toEqual([
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({ role: "user" }),
    ]);
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
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );

    const result = await inference.complete({
      messages: [{ role: "user", content: "Hi." }],
      tools: [],
      maxTokens: 120,
      temperature: 0,
    });

    expect(result).toEqual({ content: "ok", toolCalls: [] });
  });

  it("preserves provider reasoning across a tool continuation", async () => {
    const requestBodies: unknown[] = [];
    const request = async function (
      this: void,
      _input: string | URL | Request,
      init?: RequestInit,
    ) {
      expect(this).toBeUndefined();
      requestBodies.push(JSON.parse(z.string().parse(init?.body)));
      return requestBodies.length === 1
        ? Response.json({
            choices: [
              {
                message: {
                  content: null,
                  reasoning_content: "I need the current status first.",
                  tool_calls: [
                    {
                      id: "status-1",
                      type: "function",
                      function: { name: "read_status", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          })
        : Response.json({
            choices: [{ message: { content: "done", tool_calls: [] } }],
          });
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );
    const first = await inference.complete({
      messages: [{ role: "user", content: "Read the status." }],
      tools: [
        {
          name: "read_status",
          description: "Read the current status.",
          parameters: { type: "object", properties: {} },
        },
      ],
      maxTokens: 120,
      temperature: 0,
    });

    await inference.complete({
      messages: [
        { role: "user", content: "Read the status." },
        {
          role: "assistant",
          content: first.content,
          reasoning: first.reasoning,
          toolCalls: first.toolCalls,
        },
        {
          role: "tool",
          content: "ready",
          toolCallId: "status-1",
          name: "read_status",
        },
      ],
      tools: [],
      maxTokens: 120,
      temperature: 0,
    });

    expect(first.reasoning).toBe("I need the current status first.");
    expect(requestBodies[1]).toMatchObject({
      messages: [
        { role: "user" },
        {
          role: "assistant",
          reasoning_content: "I need the current status first.",
        },
        { role: "tool" },
      ],
    });
  });

  it.skipIf(!liveApiKey || liveApiKey === "test")(
    "completes a live model-to-tool-to-model round",
    async () => {
      if (!liveApiKey) throw new Error("OpenCode Go is not configured.");
      const inference = new AiSdkAgentInference(liveApiKey, traceContext());
      const runner = new DurableTurnRunner(
        new MemoryCellPersistence(),
        "live-test",
      );
      await runner.create({
        jobId: "live-test",
        leaseToken: "live-test",
        conversationId: "test",
        instruction:
          "Call read_file for /workspace/brief.md, then reply with only its content.",
        systemPrompt: "Complete the requested tool-backed task.",
        browserEnabled: false,
      });
      const tools = [
        {
          definition: {
            name: "read_file",
            description: "Read a text file.",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
          effect: "read_only" as const,
        },
      ];
      for (let step = 0; step < 4; step += 1) {
        const result = await runner.advance({
          inference,
          tools,
          scheduleRecovery: () => Promise.resolve(),
          executor: {
            execute: () => Promise.resolve({ content: "chief-runtime-ready" }),
          },
        });
        if (result.kind === "terminal") break;
      }
      const turn = await runner.active();

      expect(turn?.phase).toMatchObject({
        kind: "completed",
        result: expect.stringContaining("chief-runtime-ready"),
      });
    },
  );
});
