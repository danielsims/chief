import assert from "node:assert/strict";
import test from "node:test";

import { resolveCliRequest } from "../../channel-api/src/cli.mjs";

void test("agent CLI maps channel and member commands to local operations", () => {
  assert.deepEqual(resolveCliRequest(["channels", "list"]), {
    method: "GET",
    path: "/local-tools/channels",
    body: undefined,
  });
  assert.deepEqual(
    resolveCliRequest([
      "channels",
      "remove-member",
      "engineering",
      "researcher",
      "--json",
      '{"expectedVersion":3}',
    ]),
    {
      method: "DELETE",
      path: "/local-tools/channels/engineering/members/researcher",
      body: { expectedVersion: 3 },
    },
  );
  assert.deepEqual(
    resolveCliRequest(["channels", "list"], "channel:workspace:engineering"),
    {
      method: "GET",
      path: "/local-tools/channels?sessionId=channel%3Aworkspace%3Aengineering",
      body: undefined,
    },
  );
});

void test("agent CLI maps message search and scheduled-run commands", () => {
  assert.deepEqual(
    resolveCliRequest([
      "messages",
      "search",
      "--query",
      "pull request",
      "--limit",
      "20",
    ]),
    {
      method: "GET",
      path: "/local-tools/messages/search?query=pull+request&limit=20",
      body: undefined,
    },
  );
  assert.deepEqual(
    resolveCliRequest(["scheduled", "retry", "work-1", "run-2"]),
    {
      method: "POST",
      path: "/local-tools/scheduled-work/work-1/runs/run-2/retry",
      body: undefined,
    },
  );
  assert.deepEqual(resolveCliRequest(["scheduled", "delete", "work-1"]), {
    method: "DELETE",
    path: "/local-tools/scheduled-work/work-1",
    body: undefined,
  });
});

void test("agent CLI rejects unknown and incomplete commands", () => {
  assert.throws(
    () => resolveCliRequest(["channels", "explode"]),
    /Unknown command/,
  );
  assert.throws(
    () => resolveCliRequest(["messages", "get", "engineering"]),
    /messageId is required/,
  );
});
