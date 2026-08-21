import assert from "node:assert/strict";
import test from "node:test";

import { isExplicitWorkspaceEntry } from "../src/lib/workspace-entry.js";

void test("treats only add and invite routes as intentional workspace entry", () => {
  assert.equal(isExplicitWorkspaceEntry(""), false);
  assert.equal(isExplicitWorkspaceEntry("?intent=add"), true);
  assert.equal(
    isExplicitWorkspaceEntry("?invite=chief-desktop%3A%2F%2Fjoin"),
    true,
  );
  assert.equal(isExplicitWorkspaceEntry("?intent=onboarding"), false);
});
