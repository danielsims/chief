import assert from "node:assert/strict";
import test from "node:test";

import {
  collapsedBuildLogSummary,
  formatBuildDuration,
  formatLogTimestamp,
  VERCEL_BUILD_LOG_BODY_CLASS,
} from "../src/components/agents/eve-provisioning-dialog.tsx";

void test("build duration matches the Vercel timer style", () => {
  assert.equal(formatBuildDuration(0), "0s");
  assert.equal(formatBuildDuration(44_000), "44s");
  assert.equal(formatBuildDuration(60_000), "1m");
  assert.equal(formatBuildDuration(72_000), "1m 12s");
});

void test("log timestamps keep hour-minute-second-millis", () => {
  assert.equal(formatLogTimestamp(undefined), "");
  assert.match(
    formatLogTimestamp(1_700_000_000_000),
    /^\d{2}:\d{2}:\d{2}\.\d{3}$/u,
  );
});

void test("build log body keeps a fixed height so streaming lines do not shift layout", () => {
  assert.match(VERCEL_BUILD_LOG_BODY_CLASS, /\bh-52\b/u);
  assert.match(VERCEL_BUILD_LOG_BODY_CLASS, /\boverflow-y-auto\b/u);
});

void test("collapsed build logs show the latest line, then a short success note", () => {
  assert.equal(
    collapsedBuildLogSummary({ complete: false, failed: false, logs: [] }),
    "No output yet",
  );
  assert.equal(
    collapsedBuildLogSummary({
      complete: false,
      failed: false,
      logs: [
        { source: "stdout", text: "Retrieving project…" },
        { source: "command", text: "pnpm build" },
      ],
    }),
    "▸ pnpm build",
  );
  assert.equal(
    collapsedBuildLogSummary({ complete: true, failed: false, logs: [] }),
    "Deployed successfully",
  );
  assert.equal(
    collapsedBuildLogSummary({
      complete: true,
      failed: false,
      logs: [{ source: "stdout", text: "Build completed" }],
    }),
    "Deployed successfully",
  );
});
