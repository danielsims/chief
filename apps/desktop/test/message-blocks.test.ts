import assert from "node:assert/strict";
import test from "node:test";

import { executorToolLabel } from "../src/components/chat/executor-tool-label.ts";
import { specialistIsStartingOrWorking } from "../src/components/chat/specialist-status-indicator.tsx";

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

void test("a newly created specialist is presented as starting, not failed", () => {
  assert.equal(specialistIsStartingOrWorking("idle"), true);
  assert.equal(specialistIsStartingOrWorking("running"), true);
  assert.equal(specialistIsStartingOrWorking("waiting"), true);
  assert.equal(specialistIsStartingOrWorking("failed"), false);
  assert.equal(specialistIsStartingOrWorking("completed"), false);
});
