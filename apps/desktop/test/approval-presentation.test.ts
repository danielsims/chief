import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalBelongsToSurface,
  approvalPresentation,
} from "../src/components/chat/approval-presentation.js";

void test("explains a Codex plugin suggestion instead of calling it an Executor tool", () => {
  const presentation = approvalPresentation({
    toolName: "GitHub",
    input: {
      _meta: {
        codex_approval_kind: "tool_suggestion",
        tool_name: "GitHub",
        suggest_reason:
          "A GitHub connection lets the agent inspect commits and pull requests directly.",
      },
    },
  });

  assert.equal(presentation.title, "Add GitHub to this agent?");
  assert.match(presentation.description, /inspect commits and pull requests/u);
  assert.equal(presentation.allowLabel, "Add GitHub");
  assert.equal(presentation.denyLabel, "Not now");
});

void test("shows the exact command while protecting secret-shaped fields", () => {
  const presentation = approvalPresentation({
    toolName: "bash",
    input: {
      command: "git status --short",
      authorization: "Bearer secret",
    },
  });

  assert.equal(presentation.detail, "git status --short");
  assert.doesNotMatch(presentation.detail ?? "", /Bearer/u);
});

void test("routes approvals only to their owning conversation surface", () => {
  const threaded = { threadRootId: "thread-a" };
  assert.equal(approvalBelongsToSurface(threaded, null), false);
  assert.equal(approvalBelongsToSurface(threaded, "thread-a"), true);
  assert.equal(approvalBelongsToSurface(threaded, "thread-b"), false);
  assert.equal(approvalBelongsToSurface({}, null), true);
});
