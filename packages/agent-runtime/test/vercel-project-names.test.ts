import assert from "node:assert/strict";
import test from "node:test";

import {
  availableVercelProjectName,
  preferredVercelProjectName,
  suggestedVercelProjectName,
} from "../src/vercel-project-names.js";

void test("suggests {workspace}-chief and numbers collisions", () => {
  assert.equal(suggestedVercelProjectName("Program"), "program-chief");
  assert.equal(
    suggestedVercelProjectName("Program", ["program-chief"]),
    "program-chief-2",
  );
  assert.equal(
    suggestedVercelProjectName("Program", ["program-chief", "program-chief-2"]),
    "program-chief-3",
  );
  assert.equal(suggestedVercelProjectName("Chief"), "chief-chief");
  assert.equal(suggestedVercelProjectName(""), "workspace-chief");
});

void test("maps leftover auto Eve names onto {workspace}-chief", () => {
  assert.equal(
    preferredVercelProjectName("Program", "program-eve"),
    "program-chief",
  );
  assert.equal(
    preferredVercelProjectName("Program", "program-eve-2"),
    "program-chief",
  );
  assert.equal(
    preferredVercelProjectName("Program", "program-chief-eve"),
    "program-chief",
  );
  assert.equal(
    preferredVercelProjectName("Program", "custom-bot"),
    "custom-bot",
  );
});

void test("does not treat a stale catalog name as reserved forever", () => {
  assert.equal(
    availableVercelProjectName("program-chief", ["program-eve"]),
    "program-chief",
  );
});
