import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWorkspaceData } from "../src/lib/workspace-data.js";

void test("normalizes collections omitted by an older runtime snapshot", () => {
  const normalized = normalizeWorkspaceData({
    prospects: [
      {
        id: "prospect",
        name: "Pat",
        source: "manual",
        summary: "A saved prospect.",
        relevance: "medium",
        status: "new",
        foundAt: 0,
      },
    ],
    activity: undefined,
  });

  assert.equal(normalized.prospects.length, 1);
  assert.deepEqual(normalized.analyticsDatasets, []);
  assert.deepEqual(normalized.activity, []);
  assert.deepEqual(normalized.actionItems, []);
});

void test("normalizes an entirely missing legacy workspace snapshot", () => {
  const normalized = normalizeWorkspaceData({});

  assert.deepEqual(normalized.analyticsDatasets, []);
  assert.deepEqual(normalized.campaigns, []);
});
