import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defaultAgentConfig } from "@chief/relay-contracts";

import { AiSdkAgentInference } from "../src/ai-sdk-agent-inference";
import { openCodeSse, traceContext } from "./ai-sdk-agent-inference-harness";

const input = {
  messages: [{ role: "user" as const, content: "Hello" }],
  tools: [],
  temperature: 0,
};
const success = () =>
  openCodeSse([
    {
      id: "response",
      choices: [
        { index: 0, delta: { content: "Ready." }, finish_reason: "stop" },
      ],
    },
  ]);

describe("provider deprecation fallback", () => {
  it("migrates a persisted retired DeepSeek alias before making a provider request", async () => {
    const models: string[] = [];
    const inference = new AiSdkAgentInference(
      "key",
      traceContext(),
      async (_url, init) => {
        models.push(
          z
            .object({ model: z.string() })
            .parse(JSON.parse(z.string().parse(init?.body))).model,
        );
        return success();
      },
      { provider: "opencode", model: "opencode-go/deepseek-v4-flash" },
    );
    await expect(
      inference.complete(input, () => undefined),
    ).resolves.toMatchObject({
      content: "Ready.",
    });
    expect(models).toEqual(["deepseek-v4.1-flash"]);
    expect(inference.model.id).toBe(defaultAgentConfig.inference.model);
  });
  it.each([true, false])(
    "retries a retired model and remembers the default (streaming=%s)",
    async (streaming) => {
      const models: string[] = [];
      const inference = new AiSdkAgentInference(
        "key",
        traceContext(),
        async (_url, init) => {
          models.push(
            z
              .object({ model: z.string() })
              .parse(JSON.parse(z.string().parse(init?.body))).model,
          );
          return models.length === 1
            ? Response.json(
                {
                  error: {
                    message: "Model retired-test-model has been deprecated.",
                  },
                },
                { status: 400 },
              )
            : streaming
              ? success()
              : Response.json({
                  id: "response",
                  object: "chat.completion",
                  created: 0,
                  model: models.at(-1),
                  choices: [
                    {
                      index: 0,
                      message: { role: "assistant", content: "Ready." },
                      finish_reason: "stop",
                    },
                  ],
                });
        },
        {
          provider: "opencode",
          model: "opencode-go/retired-test-model",
          secretRef: "custom-key",
        },
      );
      await expect(
        inference.complete(input, streaming ? () => undefined : undefined),
      ).resolves.toMatchObject({
        content: "Ready.",
      });
      await inference.complete(input, streaming ? () => undefined : undefined);
      const current = defaultAgentConfig.inference.model.replace(
        /^opencode-go\//,
        "",
      );
      expect(models).toEqual(["retired-test-model", current, current]);
      expect(inference.model.id).toBe(defaultAgentConfig.inference.model);
    },
  );
  it.each([
    ["retired-test-model", "Model retired-test-model has been deprecated.", 2],
    [
      defaultAgentConfig.inference.model,
      "Model current has been deprecated.",
      1,
    ],
    ["retired-test-model", "Invalid API key", 1],
  ])("bounds retries for %s / %s", async (model, message, attempts) => {
    let calls = 0;
    const inference = new AiSdkAgentInference(
      "key",
      traceContext(),
      async () => {
        calls++;
        return Response.json({ error: { message } }, { status: 400 });
      },
      { provider: "opencode", model },
    );
    await expect(inference.complete(input)).rejects.toThrow(message);
    expect(calls).toBe(attempts);
  });
});
