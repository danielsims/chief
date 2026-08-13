import assert from "node:assert/strict";
import test from "node:test";

import { orderMentionCandidatesByMembership } from "../src/components/chat/mention-candidate-order.js";

void test("channel members appear before other mention candidates", () => {
  const candidates = [
    { id: "chief", member: false },
    { id: "engineer", member: true },
    { id: "marketer", member: false },
    { id: "prospector", member: true },
  ];

  assert.deepEqual(
    orderMentionCandidatesByMembership(candidates).map(
      (candidate) => candidate.id,
    ),
    ["engineer", "prospector", "chief", "marketer"],
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    ["chief", "engineer", "marketer", "prospector"],
  );
});
