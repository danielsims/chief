import assert from "node:assert/strict";
import test from "node:test";

import { hasInputReceipt, inputReceipt } from "../src/input-receipt.js";

void test("an input receipt is durable and idempotently identifiable", () => {
  const request = { id: "ga-access", title: "Connect Google Analytics" };
  const text = inputReceipt(request, ["the workspace environment"]);
  const events = [
    {
      type: "message" as const,
      role: "user" as const,
      content: [{ type: "text" as const, text }],
    },
  ];

  assert.match(text, /^Provided:/);
  assert.equal(hasInputReceipt(events, request.id), true);
  assert.equal(hasInputReceipt(events, "another-request"), false);
});
