import assert from "node:assert/strict";
import test from "node:test";

import { isDesktopNativeCell } from "../src/lib/desktop-cell-runtime-selection";

void test("runs a local cell for desktop-targeted agents in any workspace", () => {
  assert.equal(isDesktopNativeCell({ deploymentTarget: "desktop" }), true);
  assert.equal(isDesktopNativeCell({ deploymentTarget: "cloud" }), false);
  assert.equal(isDesktopNativeCell({ deploymentTarget: "phone" }), false);
});
