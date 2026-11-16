import assert from "node:assert/strict";
import test from "node:test";

import { workspaceRecoveryMessage } from "../src/lib/workspace-recovery";

void test("only rejected authentication suggests signing in again", () => {
  assert.match(workspaceRecoveryMessage(401), /Sign in again/);
  assert.match(workspaceRecoveryMessage(403), /don’t have access/);
  for (const status of [undefined, 404, 500, 503]) {
    assert.doesNotMatch(
      workspaceRecoveryMessage(status),
      /sign.in|don’t have access/i,
    );
    assert.equal(
      workspaceRecoveryMessage(status),
      "We couldn’t connect to this workspace.",
    );
  }
});
