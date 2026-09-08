import assert from "node:assert/strict";
import test from "node:test";

import { listHostedProviderModels } from "../src/lib/hosted-provider-models.ts";

void test("lists language models from Vercel AI Gateway", async () => {
  const models = await listHostedProviderModels("remote", (input) => {
    assert.equal(input, "https://ai-gateway.vercel.sh/v1/models");
    return Promise.resolve(
      Response.json({
        data: [
          { id: "image/model", name: "Image", type: "image" },
          { id: "openai/gpt-5", name: "GPT 5", type: "language" },
        ],
      }),
    );
  });

  assert.deepEqual(models, [{ value: "openai/gpt-5", label: "GPT 5" }]);
});

void test("lists namespaced models from OpenCode Go", async () => {
  const models = await listHostedProviderModels("opencode", (input) => {
    assert.equal(input, "https://opencode.ai/zen/go/v1/models");
    return Promise.resolve(Response.json({ data: [{ id: "glm-5.3" }] }));
  });

  assert.deepEqual(models, [
    { value: "opencode-go/glm-5.3", label: "Glm 5.3" },
  ]);
});
