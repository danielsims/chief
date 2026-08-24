import assert from "node:assert/strict";
import test from "node:test";

import { resolveExecutionPath } from "../src/paths";

void test("execution paths remain under their root", () => {
  assert.equal(
    resolveExecutionPath("/workspace", "src/index.ts"),
    "/workspace/src/index.ts",
  );
  assert.throws(() => resolveExecutionPath("/workspace", "../secret"));
  assert.throws(() => resolveExecutionPath("/workspace", "/etc/passwd"));
});
