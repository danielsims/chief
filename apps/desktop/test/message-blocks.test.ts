import assert from "node:assert/strict";
import test from "node:test";

import { executorToolLabel } from "../src/components/chat/executor-tool-label.ts";

void test("Executor activity labels current catalog calls", () => {
  assert.equal(
    executorToolLabel({
      code: 'return await tools.search({query:"analytics"})',
    }),
    "Search connected tools",
  );
  assert.equal(
    executorToolLabel({
      code: 'return await tools.describe({path:"chief-local.tools"})',
    }),
    "Inspect connected tool",
  );
  assert.equal(
    executorToolLabel({
      code: 'return await tools["chief-local.org.localworkspace.localTools.specialistsDelegate"]({})',
    }),
    "Delegate specialist work",
  );
  assert.equal(
    executorToolLabel({
      code: 'return await tools["google_analytics"]["org"]["main"]["properties"]["analyticsdataPropertiesRunReport"]({})',
    }),
    "Fetch analytics report",
  );
});
