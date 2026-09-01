import assert from "node:assert/strict";
import test from "node:test";

import { userStatusLabel } from "../src/lib/user-status.ts";

void test("formats a custom profile status", () => {
  assert.equal(
    userStatusLabel({ emoji: "🏖️", text: "Vacationing" }, "Set a status"),
    "🏖️ Vacationing",
  );
});

void test("uses profile fallback text when no status is set", () => {
  assert.equal(
    userStatusLabel(null, "daniel@example.com"),
    "daniel@example.com",
  );
});
