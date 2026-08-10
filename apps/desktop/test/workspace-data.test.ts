import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWorkspaceData } from "../src/lib/workspace-data.js";

void test("normalizes collections omitted by an older runtime snapshot", () => {
  const normalized = normalizeWorkspaceData({
    prospects: [{ id: "prospect" }],
    activity: undefined,
  });

  assert.equal(normalized.prospects.length, 1);
  assert.deepEqual(normalized.analyticsDatasets, []);
  assert.deepEqual(normalized.activity, []);
  assert.deepEqual(normalized.actionItems, []);
});

void test("rejects non-array workspace collections", () => {
  const normalized = normalizeWorkspaceData({
    analyticsDatasets: { provider: "google-analytics" },
    campaigns: null,
  });

  assert.deepEqual(normalized.analyticsDatasets, []);
  assert.deepEqual(normalized.campaigns, []);
});
