import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AiSdkAgentInference } from "../src/ai-sdk-agent-inference";
import { openCodeSse, traceContext } from "./ai-sdk-agent-inference-harness";

describe("AiSdkAgentInference streaming", () => {
  it("streams OpenCode reasoning into the hosted activity observer", async () => {
    let requestBody: unknown;
    const request = async function (
      this: void,
      _input: string | URL | Request,
      init?: RequestInit,
    ) {
      expect(this).toBeUndefined();
      requestBody = JSON.parse(z.string().parse(init?.body));
      return openCodeSse([
        {
          id: "chunk-1",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                reasoning_content: "Checking the workspace.",
              },
            },
          ],
        },
        {
          id: "chunk-1",
          choices: [
            {
              index: 0,
              delta: { content: "Ready." },
              finish_reason: "stop",
            },
          ],
        },
      ]);
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );
    const progress: string[] = [];

    const result = await inference.complete(
      {
        messages: [{ role: "user", content: "Inspect the workspace." }],
        tools: [],
        maxTokens: 120,
        temperature: 0,
      },
      (update) => {
        progress.push(update.text);
      },
    );

    expect(
      z.object({ stream: z.boolean().optional() }).parse(requestBody).stream,
    ).toBe(true);
    expect(progress).toEqual(["Checking the workspace."]);
    expect(result).toEqual({
      content: "Ready.",
      reasoning: "Checking the workspace.",
      toolCalls: [],
    });
  });

  it("keeps a completed OpenCode stream when the provider appends a ping", async () => {
    const request = async function (this: void) {
      expect(this).toBeUndefined();
      return openCodeSse(
        [
          {
            id: "chunk-1",
            choices: [
              {
                index: 0,
                delta: { content: "Ready." },
                finish_reason: "stop",
              },
            ],
          },
        ],
        ["event: ping\ndata:"],
      );
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );

    await expect(
      inference.complete(
        {
          messages: [{ role: "user", content: "Say ready." }],
          tools: [],
          maxTokens: 120,
          temperature: 0,
        },
        () => undefined,
      ),
    ).resolves.toEqual({ content: "Ready.", toolCalls: [] });
  });

  it("surfaces an empty OpenCode stream error instead of a blank APICallError", async () => {
    const request = async function (this: void) {
      expect(this).toBeUndefined();
      return openCodeSse([{ error: { message: "" } }]);
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );

    await expect(
      inference.complete(
        {
          messages: [{ role: "user", content: "Hi." }],
          tools: [],
          maxTokens: 120,
          temperature: 0,
        },
        () => undefined,
      ),
    ).rejects.toThrow(/empty body|empty error|stream error/i);
  });

  it("sends thinking-mode reasoning back on a text-only continuation", async () => {
    let requestBody: unknown;
    const request = async function (
      this: void,
      _input: string | URL | Request,
      init?: RequestInit,
    ) {
      expect(this).toBeUndefined();
      requestBody = JSON.parse(z.string().parse(init?.body));
      return openCodeSse([
        {
          id: "chunk-1",
          choices: [
            {
              index: 0,
              delta: { content: "Posted." },
              finish_reason: "stop",
            },
          ],
        },
      ]);
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );

    await inference.complete(
      {
        messages: [
          { role: "user", content: "Summarize the brand." },
          {
            role: "assistant",
            content: "I'll post the profile next.",
            reasoning: "The profile is saved; the channel needs the summary.",
          },
        ],
        tools: [],
        maxTokens: 120,
        temperature: 0,
      },
      () => undefined,
    );

    expect(requestBody).toMatchObject({
      messages: [
        { role: "user" },
        {
          role: "assistant",
          content: "I'll post the profile next.",
          reasoning_content:
            "The profile is saved; the channel needs the summary.",
        },
      ],
    });
  });

  it("streams tool-call reasoning back on the next OpenCode request", async () => {
    const requestBodies: unknown[] = [];
    const request = async function (
      this: void,
      _input: string | URL | Request,
      init?: RequestInit,
    ) {
      expect(this).toBeUndefined();
      requestBodies.push(JSON.parse(z.string().parse(init?.body)));
      return requestBodies.length === 1
        ? openCodeSse([
            {
              id: "chunk-1",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    reasoning_content: "I need the current status first.",
                    tool_calls: [
                      {
                        index: 0,
                        id: "status-1",
                        type: "function",
                        function: { name: "read_status", arguments: "{}" },
                      },
                    ],
                  },
                },
              ],
            },
            {
              id: "chunk-1",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "tool_calls",
                },
              ],
            },
          ])
        : openCodeSse([
            {
              id: "chunk-2",
              choices: [
                {
                  index: 0,
                  delta: { content: "done" },
                  finish_reason: "stop",
                },
              ],
            },
          ]);
    };
    const inference = new AiSdkAgentInference(
      "test-key",
      traceContext(),
      request,
    );
    const first = await inference.complete(
      {
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
      },
      () => undefined,
    );

    await inference.complete(
      {
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
      },
      () => undefined,
    );

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
});
