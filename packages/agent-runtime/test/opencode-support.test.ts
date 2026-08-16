import assert from "node:assert/strict";
import test from "node:test";

import { openCodeConfigContent } from "../src/drivers/opencode-support.js";

void test("full OpenCode sessions cannot stall on hidden external-directory approval", () => {
  const config = JSON.parse(
    openCodeConfigContent(
      { access: "full", model: "opencode-go/deepseek-v4-flash" },
      JSON.stringify({
        permission: { bash: { "*": "ask", "git status*": "allow" } },
      }),
    ),
  ) as Record<string, unknown>;

  assert.equal(config.model, "opencode-go/deepseek-v4-flash");
  assert.deepEqual(config.permission, {
    bash: { "*": "ask", "git status*": "allow" },
    external_directory: "allow",
  });
});

void test("guarded OpenCode sessions do not widen ambient permissions", () => {
  const inherited = JSON.stringify({
    permission: { external_directory: "deny", edit: "ask" },
  });
  const config = JSON.parse(
    openCodeConfigContent({ access: "guarded", model: "" }, inherited),
  ) as Record<string, unknown>;

  assert.deepEqual(config.permission, {
    external_directory: "deny",
    edit: "ask",
  });
  assert.equal("model" in config, false);
});

void test("full OpenCode sessions recover from malformed ambient config", () => {
  const config = JSON.parse(
    openCodeConfigContent({ access: "full", model: "model-id" }, "not-json"),
  ) as Record<string, unknown>;

  assert.equal(config.model, "model-id");
  assert.deepEqual(config.permission, { external_directory: "allow" });
});
