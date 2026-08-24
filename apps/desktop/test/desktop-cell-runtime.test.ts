import assert from "node:assert/strict";
import test from "node:test";

import { shouldStartDesktopCells } from "../src/lib/desktop-cell-runtime-selection";

for (const runtime of ["mac", "cloud", null] as const) {
  void test(`starts a portable desktop executor for ${String(runtime)} workspaces`, () => {
    assert.equal(shouldStartDesktopCells(runtime), true);
  });
}

void test("leaves phone workspaces to their phone executor", () => {
  assert.equal(shouldStartDesktopCells("phone"), false);
});
