import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { materializeEveWorkspace } from "../src/eve-workspace.js";

function read(root: string, path: string) {
  return readFileSync(join(root, path), "utf8");
}

void test("materializes one Chief root with private inspect-only specialists", () => {
  const root = mkdtempSync(join(tmpdir(), "chief-eve-workspace-"));

  try {
    const result = materializeEveWorkspace(root, {
      context: "Acme sells anvils.",
      hostedExecutor: true,
      controlPlane: true,
      channels: [{ kind: "slack" }],
    });

    assert.equal(result.agent.id, "chief");
    assert.deepEqual(result.specialistIds, [
      "brand",
      "content",
      "analyst",
      "prospector",
      "ads",
      "engineer",
      "setup",
    ]);
    assert.match(read(root, "agent/agent.ts"), /experimental_chatgpt\(\)/);
    assert.match(read(root, "agent/agent.ts"), /xai\/grok-4\.3/);
    assert.match(
      read(root, "agent/agent.ts"),
      /maxInputTokensPerSession: 500_000/,
    );
    assert.match(read(root, "agent/sandbox.ts"), /networkPolicy: "deny-all"/);
    assert.match(read(root, "agent/sandbox.ts"), /defaultBackend/);
    assert.equal(existsSync(join(root, "agent/tools/agent.ts")), false);
    assert.match(read(root, "agent/channels/eve.ts"), /httpBasic/);
    assert.match(read(root, "agent/channels/slack.ts"), /slackChannel/);
    assert.match(
      read(root, "agent/connections/chief.ts"),
      /CHIEF_CONTROL_PLANE_TOKEN/,
    );
    assert.match(
      read(root, "agent/connections/executor.ts"),
      /https:\/\/executor\.invalid\/mcp/,
    );
    assert.match(
      read(root, "agent/connections/executor.ts"),
      /EXECUTOR_MCP_TOKEN is required/,
    );
    assert.doesNotMatch(
      read(root, "agent/connections/executor.ts"),
      /localhost/,
    );
    assert.match(
      read(root, "agent/subagents/brand/skills/build-brand-profile.md"),
      /# Build brand profile/,
    );
    assert.match(
      read(root, "agent/subagents/prospector/skills/find-buying-signals.md"),
      /# Find buying signals/,
    );
    assert.match(
      read(root, "agent/subagents/setup/skills/setup-google-analytics.md"),
      /# Setup Google Analytics/,
    );

    for (const specialist of [
      "brand",
      "content",
      "analyst",
      "prospector",
      "ads",
      "setup",
    ]) {
      const base = `agent/subagents/${specialist}`;
      const instructions = read(root, `${base}/instructions.md`);
      assert.match(instructions, /private, inspect-only specialist/);
      assert.match(instructions, /Acme sells anvils/);
      assert.doesNotMatch(
        instructions,
        /brandProfileSave|contentSave|uiPresentChart|prospectsSave|campaignsSave|localTools|tools\.chief/,
      );
      assert.match(read(root, `${base}/agent.ts`), /experimental_chatgpt\(\)/);
      assert.match(
        read(root, `${base}/agent.ts`),
        /maxInputTokensPerSession: 100_000/,
      );
      assert.match(
        read(root, `${base}/agent.ts`),
        /Private inspect-only specialist/,
      );
      assert.match(
        read(root, `${base}/sandbox.ts`),
        /networkPolicy: "deny-all"/,
      );
      assert.match(read(root, `${base}/tools/bash.ts`), /disableTool\(\)/);
      assert.match(
        read(root, `${base}/tools/write_file.ts`),
        /disableTool\(\)/,
      );
      assert.equal(
        existsSync(join(root, base, "connections")),
        specialist === "setup" ||
          specialist === "prospector" ||
          specialist === "brand",
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("materializes a standalone specialist as the user-visible Eve root", () => {
  const root = mkdtempSync(join(tmpdir(), "chief-eve-analyst-"));
  try {
    const result = materializeEveWorkspace(root, {
      agentId: "analyst",
      context: "Acme sells anvils.",
    });
    assert.equal(result.agent.id, "analyst");
    assert.deepEqual(result.specialistIds, []);
    assert.equal(existsSync(join(root, "agent/subagents")), false);
    assert.match(
      read(root, "agent/instructions.md"),
      /workspace's marketing analyst/,
    );
    assert.match(
      read(root, "agent/instructions.md"),
      /no configured subagents/,
    );
    assert.doesNotMatch(
      read(root, "agent/instructions.md"),
      /private, inspect-only specialist/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("materializes a standalone agent with its filesystem skills", () => {
  const root = mkdtempSync(join(tmpdir(), "chief-eve-marketer-"));
  try {
    materializeEveWorkspace(root, { agentId: "brand" });
    assert.match(
      read(root, "agent/skills/build-brand-profile.md"),
      /name: build-brand-profile/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("refuses active cloud schedules instead of emitting prompt-only grants", () => {
  const root = mkdtempSync(join(tmpdir(), "chief-eve-schedule-"));

  try {
    assert.throws(
      () =>
        materializeEveWorkspace(root, {
          automations: [
            {
              id: "weekly-report",
              agentId: "analyst",
              cron: "0 9 * * 1",
              timezone: "UTC",
              instructions: "Review the latest complete week.",
              grant: {
                version: 1,
                approvedAt: 1,
                toolPatterns: ["tools.chief.*"],
              },
              placement: "cloud",
              status: "active",
            },
          ],
        }),
      /schedule-scoped capabilities.*weekly-report/,
    );
    const result = materializeEveWorkspace(root, {
      automations: [
        {
          id: "paused-report",
          agentId: "analyst",
          cron: "0 10 * * 1",
          timezone: "UTC",
          instructions: "Do not run.",
          placement: "cloud",
          status: "paused",
        },
      ],
    });
    assert.equal(result.automationCount, 0);
    assert.equal(
      existsSync(join(root, "agent/schedules/paused-report.md")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("rejects generated path traversal and unsupported schedule timing", () => {
  const root = mkdtempSync(join(tmpdir(), "chief-eve-invalid-"));

  try {
    assert.throws(
      () =>
        materializeEveWorkspace(root, {
          playbooks: [
            {
              id: "../escape",
              title: "Escape",
              summary: "Bad id",
              instructions: "No.",
            },
          ],
        }),
      /Invalid playbook id/,
    );

    writeFileSync(join(root, "agent", "stale.txt"), "unrelated");
    materializeEveWorkspace(root, {});
    assert.equal(existsSync(join(root, "agent", "stale.txt")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
