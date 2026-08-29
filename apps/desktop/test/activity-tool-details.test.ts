import assert from "node:assert/strict";
import test from "node:test";

import {
  formatActivityValue,
  redactActivityValue,
} from "../src/components/chat/activity-tool-details.js";

void test("redacts credential-shaped tool parameters recursively", () => {
  assert.deepEqual(
    redactActivityValue({
      query: "open pull requests",
      authorization: "Bearer top-secret",
      nested: {
        apiKey: "secret-key",
        path: "/projects/chief",
      },
    }),
    {
      query: "open pull requests",
      authorization: "[redacted]",
      nested: {
        apiKey: "[redacted]",
        path: "/projects/chief",
      },
    },
  );
});

void test("redacts bearer tokens and sensitive URL parameters in text output", () => {
  assert.equal(
    formatActivityValue(
      "https://example.com/callback?code=public&access_token=secret",
    ),
    "https://example.com/callback?code=public&access_token=%5Bredacted%5D",
  );
  assert.equal(
    formatActivityValue("Authorization failed for Bearer abc.def.ghi"),
    "Authorization failed for Bearer [redacted]",
  );
});

void test("formats structured tool values as readable JSON", () => {
  assert.equal(
    formatActivityValue({ status: "ok", count: 3 }),
    '{\n  "status": "ok",\n  "count": 3\n}',
  );
});
