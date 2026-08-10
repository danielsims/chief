import assert from "node:assert/strict";
import test from "node:test";

import { capabilityForWorkspace } from "../src/lib/workspace-capability.js";

const capability = {
  apiBaseUrl: "https://example.convex.site",
  token: "a".repeat(43),
};

void test("never returns a capability captured for another workspace", () => {
  const scoped = { workspaceId: "old-workspace", capability };

  assert.equal(capabilityForWorkspace("new-workspace", scoped), null);
  assert.equal(capabilityForWorkspace(null, scoped), null);
  assert.equal(capabilityForWorkspace("old-workspace", scoped), capability);
});
