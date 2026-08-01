import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { materializeConvexWorkspace } from "../src/convex-workspace.js";

void test("compiles Chief and all bounded specialists into the Convex template", () => {
  const root = mkdtempSync(join(tmpdir(), "chief-convex-compiler-"));
  try {
    mkdirSync(join(root, "convex"));
    const result = materializeConvexWorkspace(root, {
      context: "Acme sells anvils.",
      playbooks: [
        {
          id: "launch",
          title: "Launch",
          summary: "Launch a product.",
          instructions: "Start with customer evidence.",
        },
      ],
    });
    assert.deepEqual(result.specialistIds, [
      "brand",
      "content",
      "analyst",
      "prospector",
      "ads",
      "setup",
    ]);
    const generated = readFileSync(
      join(root, "convex", "generated.ts"),
      "utf8",
    );
    assert.match(generated, /Acme sells anvils/);
    assert.match(generated, /Launch a product/);
    assert.doesNotMatch(generated, /Start with customer evidence/);
    assert.match(generated, /private .* specialist/i);
    assert.doesNotMatch(
      generated,
      /AI_GATEWAY_API_KEY|CHIEF_CONTROL_PLANE_TOKEN/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("compiles a standalone specialist without Chief subagents", () => {
  const root = mkdtempSync(join(tmpdir(), "chief-convex-analyst-"));
  try {
    mkdirSync(join(root, "convex"));
    const result = materializeConvexWorkspace(root, { agentId: "analyst" });
    assert.deepEqual(result.specialistIds, []);
    const generated = readFileSync(
      join(root, "convex", "generated.ts"),
      "utf8",
    );
    assert.match(generated, /workspace's marketing analyst/);
    assert.match(generated, /no subagents/);
    assert.match(generated, /SPECIALIST_INSTRUCTIONS = \{\}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("compiler rejects active cloud schedules", () => {
  const root = mkdtempSync(join(tmpdir(), "chief-convex-schedule-"));
  try {
    mkdirSync(join(root, "convex"));
    assert.throws(
      () =>
        materializeConvexWorkspace(root, {
          automations: [
            {
              id: "daily",
              agentId: "analyst",
              cron: "0 9 * * *",
              timezone: "UTC",
              instructions: "Report.",
              placement: "cloud",
              status: "active",
            },
          ],
        }),
      /minimal Convex runtime: daily/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("Convex template keeps typechecking enabled on redeploy", () => {
  assert.equal(
    existsSync(
      join(import.meta.dirname, "../templates/convex/convex/tsconfig.json"),
    ),
    true,
  );
});
