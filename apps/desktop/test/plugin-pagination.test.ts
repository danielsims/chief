import assert from "node:assert/strict";
import test from "node:test";

import { pagePluginGroups } from "../src/lib/plugin-pagination";

void test("pages across categories without losing order or duplicating plugins", () => {
  const groups: [string, number[]][] = [
    ["Featured", [1, 2]],
    ["Engineering", [3, 4, 5]],
    ["Other", [6]],
  ];
  assert.deepEqual(pagePluginGroups(groups, 4), [
    ["Featured", [1, 2]],
    ["Engineering", [3, 4]],
  ]);
  assert.deepEqual(pagePluginGroups(groups, 48), groups);
  assert.deepEqual(pagePluginGroups(groups, 0), []);
  assert.deepEqual(groups[1]?.[1], [3, 4, 5]);
});
void test("filtered results start at the beginning and omit empty categories", () => {
  assert.deepEqual(
    pagePluginGroups(
      [
        ["Empty", []],
        ["Matches", [7, 8]],
      ],
      1,
    ),
    [["Matches", [7]]],
  );
});
