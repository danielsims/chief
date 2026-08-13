import assert from "node:assert/strict";
import test from "node:test";

import { retainUsefulProviderModels } from "../src/lib/provider-model-cache";

void test("keeps useful cached models when discovery temporarily returns only Auto", () => {
  const cached = [
    { value: "", label: "Auto" },
    { value: "opencode-go/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  ];

  assert.deepEqual(
    retainUsefulProviderModels(cached, [{ value: "", label: "Auto" }]),
    cached,
  );
});

void test("replaces cached models after successful discovery", () => {
  const discovered = [
    { value: "", label: "Auto" },
    { value: "gpt-5.6-sol", label: "GPT 5.6 Sol" },
  ];

  assert.deepEqual(retainUsefulProviderModels([], discovered), discovered);
});
