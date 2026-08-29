import assert from "node:assert/strict";
import test from "node:test";

import type { RecurringWorkSettingsManager } from "../src/recurring-work-settings.js";
import type { RecurringWorkRecord } from "../src/types.js";
import {
  rotateRecurringWorkWebhook,
  saveRecurringWorkSettings,
} from "../src/recurring-work-settings.js";

function scheduledWork(): RecurringWorkRecord {
  return {
    id: "heartbeat",
    agentId: "chief",
    title: "Chief heartbeat",
    instructions: "Assess the workspace.",
    cron: "0 9 * * *",
    timezone: "Australia/Brisbane",
    trigger: {
      type: "cron",
      expression: "0 9 * * *",
      timezone: "Australia/Brisbane",
    },
    status: "active",
    placement: "local",
    approvalSummary: "Chief checks the workspace.",
    proposedToolPatterns: [],
    grant: { version: 1, approvedAt: 1, toolPatterns: [] },
    createdAt: 1,
    updatedAt: 1,
  };
}

function fixture(initial = scheduledWork()) {
  let work = initial;
  let webhookHash: string | undefined;
  const manager = {
    recurringWorkById: () => Promise.resolve(work),
    saveRecurringWork: (_workspaceId: string, next: RecurringWorkRecord) => {
      work = next;
      return Promise.resolve();
    },
    setScheduleWebhookSecretHash: (
      _workspaceId: string,
      _workId: string,
      hash: string | undefined,
    ) => {
      webhookHash = hash;
      return Promise.resolve();
    },
  } satisfies RecurringWorkSettingsManager;
  return {
    manager,
    work: () => work,
    webhookHash: () => webhookHash,
  };
}

void test("a heartbeat can switch between cron and webhook triggers", async () => {
  const state = fixture();
  const webhook = await saveRecurringWorkSettings(state.manager, "workspace", {
    ...state.work(),
    trigger: { type: "webhook" },
  });
  assert.deepEqual(webhook.saved.trigger, { type: "webhook" });
  assert.equal(webhook.saved.nextAt, undefined);
  await rotateRecurringWorkWebhook(
    state.manager,
    "workspace",
    "heartbeat",
    "http://127.0.0.1:4318",
  );
  assert.ok(state.webhookHash());

  const cron = await saveRecurringWorkSettings(state.manager, "workspace", {
    ...state.work(),
    cron: "0 * * * *",
    timezone: "Australia/Brisbane",
    trigger: {
      type: "cron",
      expression: "0 * * * *",
      timezone: "Australia/Brisbane",
    },
  });
  assert.deepEqual(cron.saved.trigger, {
    type: "cron",
    expression: "0 * * * *",
    timezone: "Australia/Brisbane",
  });
  assert.ok(cron.saved.nextAt);
  assert.equal(state.webhookHash(), undefined);
});

void test("webhook rotation returns a one-time local URL", async () => {
  const state = fixture({
    ...scheduledWork(),
    trigger: { type: "webhook" },
    nextAt: undefined,
  });
  const url = await rotateRecurringWorkWebhook(
    state.manager,
    "workspace",
    "heartbeat",
    "http://127.0.0.1:4318",
  );
  assert.match(
    url,
    /^http:\/\/127\.0\.0\.1:4318\/hooks\/scheduled-runs\/heartbeat\//u,
  );
  assert.match(state.webhookHash() ?? "", /^[a-f0-9]{64}$/u);
});
