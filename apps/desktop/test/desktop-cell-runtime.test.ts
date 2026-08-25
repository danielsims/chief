import assert from "node:assert/strict";
import test from "node:test";

import { shouldStartDesktopCells } from "../src/lib/desktop-cell-runtime-selection";

void test("starts desktop cells only for workspaces deployed to this Mac", () => {
  assert.equal(shouldStartDesktopCells("mac"), true);
  assert.equal(shouldStartDesktopCells("cloud"), false);
  assert.equal(shouldStartDesktopCells("phone"), false);
  assert.equal(shouldStartDesktopCells(null), false);
});
