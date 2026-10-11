import assert from "node:assert/strict";
import test from "node:test";

import {
  expireWorkingRuns,
  reduceWorkingRuns,
  WORKING_RUN_EXPIRY_MS,
  workingAgentIdsFromRuns,
} from "../src/lib/use-working-agents";

void test("an agent stays working until every one of its runs ends", () => {
  let runs = reduceWorkingRuns(
    new Map(),
    { channelId: "dm-1", agentId: "engineer", working: true },
    1,
  );
  runs = reduceWorkingRuns(
    runs,
    {
      channelId: "marketing",
      threadRootId: "root:1",
      agentId: "engineer",
      working: true,
    },
    2,
  );
  runs = reduceWorkingRuns(
    runs,
    { channelId: "dm-1", agentId: "engineer", working: false },
    3,
  );
  assert.deepEqual([...workingAgentIdsFromRuns(runs)], ["engineer"]);
  runs = reduceWorkingRuns(
    runs,
    {
      channelId: "marketing",
      threadRootId: "root:1",
      agentId: "engineer",
      working: false,
    },
    4,
  );
  assert.equal(workingAgentIdsFromRuns(runs).size, 0);
});

void test("a reply from an idle agent leaves state untouched", () => {
  const empty = new Map<string, number>();
  assert.equal(
    reduceWorkingRuns(
      empty,
      { channelId: "dm-1", agentId: "chief", working: false },
      1,
    ),
    empty,
  );
});

void test("a run that goes quiet expires", () => {
  const runs = reduceWorkingRuns(
    new Map(),
    { channelId: "dm-1", agentId: "chief", working: true },
    0,
  );
  assert.equal(expireWorkingRuns(runs, WORKING_RUN_EXPIRY_MS - 1), runs);
  assert.equal(expireWorkingRuns(runs, WORKING_RUN_EXPIRY_MS).size, 0);
});
