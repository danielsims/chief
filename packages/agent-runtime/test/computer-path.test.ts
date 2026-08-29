import assert from "node:assert/strict";
import test from "node:test";

import { computerPathSchema } from "../src/tools/toolkits/computer/input.js";

void test("computer root resolves to the isolated workspace root", () => {
  assert.equal(computerPathSchema.parse("/"), "/workspace");
});
