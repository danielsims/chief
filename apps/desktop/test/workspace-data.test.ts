import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWorkspaceData } from "../src/lib/workspace-data.js";

void test("normalizes collections omitted by an older runtime snapshot", () => {
  const normalized = normalizeWorkspaceData({
    trends: [
      {
        id: "trend",
        title: "A signal",
        source: "manual",
        summary: "A saved trend.",
        signal: "medium",
        status: "new",
        foundAt: 0,
      },
    ],
    activity: undefined,
  });

  assert.equal(normalized.trends.length, 1);
  assert.deepEqual(normalized.analyticsDatasets, []);
  assert.deepEqual(normalized.activity, []);
  assert.deepEqual(normalized.actionItems, []);
});

void test("normalizes an entirely missing legacy workspace snapshot", () => {
  const normalized = normalizeWorkspaceData({});

  assert.deepEqual(normalized.analyticsDatasets, []);
  assert.deepEqual(normalized.campaigns, []);
});
