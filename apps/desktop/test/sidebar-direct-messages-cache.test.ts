import assert from "node:assert/strict";
import test from "node:test";

import {
  orderSidebarDirectMessages,
  parseSidebarDirectMessagesCache,
} from "../src/lib/sidebar-direct-messages-cache";

void test("orders DMs newest first and keeps roster order for quiet ones", () => {
  const ordered = orderSidebarDirectMessages(
    [
      { key: "agent:chief", live: 0 },
      { key: "agent:engineer", live: 200 },
      { key: "channel:ada", live: 0 },
      { key: "agent:designer", live: 0 },
      { key: "channel:grace", live: 300 },
    ],
    {},
  );
  assert.deepEqual(
    ordered.map((entry) => entry.key),
    [
      "channel:grace",
      "agent:engineer",
      "agent:chief",
      "channel:ada",
      "agent:designer",
    ],
  );
});

void test("a DM keeps its place while its history is reloading", () => {
  const remembered = { "agent:chief": 500, "agent:engineer": 200 };
  const ordered = orderSidebarDirectMessages(
    [
      { key: "agent:engineer", live: 200 },
      // History not back yet: live time is momentarily unknown.
      { key: "agent:chief", live: 0 },
    ],
    remembered,
  );
  assert.deepEqual(
    ordered.map((entry) => [entry.key, entry.at]),
    [
      ["agent:chief", 500],
      ["agent:engineer", 200],
    ],
  );
});

void test("a new message moves its DM to the top", () => {
  const ordered = orderSidebarDirectMessages(
    [
      { key: "agent:chief", live: 500 },
      { key: "agent:engineer", live: 900 },
    ],
    { "agent:chief": 500, "agent:engineer": 200 },
  );
  assert.equal(ordered[0]?.key, "agent:engineer");
});

void test("an unreadable DM cache falls back to empty", () => {
  assert.deepEqual(parseSidebarDirectMessagesCache("{not json"), {
    people: [],
    lastMessageAt: {},
  });
  assert.deepEqual(parseSidebarDirectMessagesCache(null), {
    people: [],
    lastMessageAt: {},
  });
});
