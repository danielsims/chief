import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { RecurringWorkRecord, SessionRecord } from "../src/types.js";
import { handleScheduledWorkLocalTool } from "../src/scheduled-work-local-tools.js";
import { dispatchScheduledWorkEvent } from "../src/scheduled-work-triggers.js";
import { handleScheduledWorkWebhook } from "../src/scheduled-work-webhook.js";

function request(path: string, method: string, body?: unknown) {
  return new Request(`http://127.0.0.1:4318${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function fixture() {
  const work = new Map<string, RecurringWorkRecord>();
  const runs = new Map<string, SessionRecord[]>();
  const actionItems: unknown[] = [];
  const webhookHashes = new Map<string, string>();
  const manager = {
    workspaceData: () => Promise.resolve({ recurringWork: [...work.values()] }),
    recurringWorkByOperationKey: (_workspaceId: string, operationKey: string) =>
      Promise.resolve(
        [...work.values()].find((item) => item.operationKey === operationKey),
      ),
    recurringWorkById: (_workspaceId: string, id: string) =>
      Promise.resolve(work.get(id)),
    recurringWorkWorkspaceId: (id: string) =>
      Promise.resolve(work.has(id) ? "workspace-a" : undefined),
    saveRecurringWork: (_workspaceId: string, item: RecurringWorkRecord) => {
      work.set(item.id, item);
      return Promise.resolve();
    },
    raiseActionItem: (_workspaceId: string, item: unknown) => {
      actionItems.push(item);
      return Promise.resolve();
    },
    scheduleRuns: (_workspaceId: string, scheduleId: string) =>
      Promise.resolve(runs.get(scheduleId) ?? []),
    scheduleRun: (_workspaceId: string, scheduleId: string, runId: string) =>
      Promise.resolve(
        (runs.get(scheduleId) ?? []).find((run) => run.id === runId),
      ),
    scheduleWebhookSecretHash: (_workspaceId: string, scheduleId: string) =>
      Promise.resolve(webhookHashes.get(scheduleId)),
    setScheduleWebhookSecretHash: (
      _workspaceId: string,
      scheduleId: string,
      hash: string | undefined,
    ) => {
      if (hash) webhookHashes.set(scheduleId, hash);
      else webhookHashes.delete(scheduleId);
      return Promise.resolve();
    },
  };
  const queued: {
    scheduleId: string;
    triggerId?: string;
    context?: Record<string, unknown>;
  }[] = [];
  const runner = {
    runNow: (_workspaceId: string, scheduleId: string) => {
      queued.push({ scheduleId });
      return Promise.resolve();
    },
    runTriggered: (
      _workspaceId: string,
      scheduleId: string,
      triggerId: string,
      context: Record<string, unknown>,
    ) => {
      queued.push({ scheduleId, triggerId, context });
      return Promise.resolve();
    },
    cancelRun: (runId: string) => Promise.resolve(runId === "run-1"),
  };
  const call = (
    path: string,
    method: string,
    body: Record<string, unknown> = {},
  ) =>
    handleScheduledWorkLocalTool({
      request: request(path, method, method === "GET" ? undefined : body),
      workspaceId: "workspace-a",
      body,
      manager: manager as never,
      runner,
      conversationId: "conversation-a",
      origin: "http://127.0.0.1:4318",
    });
  return {
    work,
    runs,
    actionItems,
    webhookHashes,
    manager,
    runner,
    queued,
    call,
  };
}

function storedWork(
  state: ReturnType<typeof fixture>,
  id: string,
): RecurringWorkRecord {
  const stored = state.work.get(id);
  assert.ok(stored);
  return stored;
}

const createBody = {
  operationKey: "engineering-pr-review",
  agentId: "engineer",
  title: "Review new pull requests",
  instructions:
    "Review the pull request, summarize risks, and post the result in the feature channel.",
  trigger: {
    type: "channel_message",
    channelId: "engineering",
    contains: "pull request",
  },
  approvalSummary: "Runs when a human posts a pull request in engineering.",
  proposedToolPatterns: ["tools.github.pull_requests.read"],
};

void test("scheduled work commands are idempotent, versioned, and approval bounded", async () => {
  const state = fixture();
  const created = await state.call(
    "/local-tools/scheduled-work",
    "POST",
    createBody,
  );
  assert.equal(created.status, undefined);
  const scheduledWork = (
    created.value as { scheduledWork: RecurringWorkRecord }
  ).scheduledWork;
  assert.equal(scheduledWork.status, "draft");
  assert.equal(scheduledWork.trigger?.type, "channel_message");
  assert.equal(state.actionItems.length, 1);

  const replay = await state.call(
    "/local-tools/scheduled-work",
    "POST",
    createBody,
  );
  assert.equal((replay.value as { replayed: boolean }).replayed, true);
  assert.equal(state.work.size, 1);

  const stale = await state.call(
    `/local-tools/scheduled-work/${scheduledWork.id}`,
    "PATCH",
    {
      expectedVersion: 2,
      title: "Stale title",
    },
  );
  assert.equal(stale.status, 409);
  const updated = await state.call(
    `/local-tools/scheduled-work/${scheduledWork.id}`,
    "PATCH",
    {
      expectedVersion: 1,
      title: "Review engineering pull requests",
      trigger: {
        type: "reaction_added",
        channelId: "engineering",
        emoji: "👀",
      },
    },
  );
  const updatedWork = (updated.value as { scheduledWork: RecurringWorkRecord })
    .scheduledWork;
  assert.equal(updatedWork.version, 2);
  assert.equal(updatedWork.trigger?.type, "reaction_added");

  const stored = storedWork(state, scheduledWork.id);
  state.work.set(scheduledWork.id, {
    ...stored,
    status: "active",
    grant: {
      version: 1,
      approvedAt: Date.now(),
      toolPatterns: stored.proposedToolPatterns,
    },
  });
  const paused = await state.call(
    `/local-tools/scheduled-work/${scheduledWork.id}/pause`,
    "POST",
  );
  assert.equal(
    (paused.value as { scheduledWork: RecurringWorkRecord }).scheduledWork
      .status,
    "paused",
  );
  const resumed = await state.call(
    `/local-tools/scheduled-work/${scheduledWork.id}/resume`,
    "POST",
  );
  assert.equal(
    (resumed.value as { scheduledWork: RecurringWorkRecord }).scheduledWork
      .status,
    "active",
  );
});

void test("narrowing proposed tools narrows the live grant without another approval", async () => {
  const state = fixture();
  const created = await state.call("/local-tools/scheduled-work", "POST", {
    ...createBody,
    proposedToolPatterns: [
      "tools.github.pull_requests.read",
      "tools.github.issues.read",
    ],
  });
  const scheduledWork = (
    created.value as { scheduledWork: RecurringWorkRecord }
  ).scheduledWork;
  const stored = storedWork(state, scheduledWork.id);
  state.work.set(scheduledWork.id, {
    ...stored,
    status: "active",
    grant: {
      version: 1,
      approvedAt: 1,
      toolPatterns: stored.proposedToolPatterns,
    },
  });

  const response = await state.call(
    `/local-tools/scheduled-work/${scheduledWork.id}`,
    "PATCH",
    {
      expectedVersion: 1,
      proposedToolPatterns: ["tools.github.pull_requests.read"],
    },
  );
  const result = response.value as {
    scheduledWork: RecurringWorkRecord;
    requiresUserApproval: boolean;
  };
  assert.equal(result.requiresUserApproval, false);
  assert.deepEqual(result.scheduledWork.grant?.toolPatterns, [
    "tools.github.pull_requests.read",
  ]);
});

void test("scheduled work run commands expose history, cancellation, retry, and replay safety", async () => {
  const state = fixture();
  const created = await state.call(
    "/local-tools/scheduled-work",
    "POST",
    createBody,
  );
  const scheduledWork = (
    created.value as { scheduledWork: RecurringWorkRecord }
  ).scheduledWork;
  const stored = storedWork(state, scheduledWork.id);
  state.work.set(scheduledWork.id, {
    ...stored,
    status: "active",
    grant: {
      version: 1,
      approvedAt: 1,
      toolPatterns: stored.proposedToolPatterns,
    },
  });
  const run: SessionRecord = {
    id: "run-1",
    scheduleId: scheduledWork.id,
    triggerId: "channel-event:event-1",
    triggerContext: { type: "channel_message", eventId: "event-1" },
    kind: "task",
    visibility: "private",
    agent: "cmo",
    title: scheduledWork.title,
    provider: "codex",
    status: "failed",
    attempt: 1,
    createdAt: 1,
    updatedAt: 2,
  };
  state.runs.set(scheduledWork.id, [run]);

  const history = await state.call(
    `/local-tools/scheduled-work/${scheduledWork.id}/runs`,
    "GET",
  );
  assert.equal(
    (history.value as { runs: SessionRecord[] }).runs[0]?.id,
    "run-1",
  );
  const details = await state.call(
    `/local-tools/scheduled-work/${scheduledWork.id}/runs/run-1`,
    "GET",
  );
  assert.equal(
    (details.value as { run: SessionRecord }).run.triggerContext?.eventId,
    "event-1",
  );
  const cancelled = await state.call(
    `/local-tools/scheduled-work/${scheduledWork.id}/runs/run-1/cancel`,
    "POST",
  );
  assert.equal((cancelled.value as { cancelled: boolean }).cancelled, true);
  await state.call(
    `/local-tools/scheduled-work/${scheduledWork.id}/runs/run-1/retry`,
    "POST",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.queued.at(-1)?.triggerId, "retry:run-1:2");

  await state.call(
    `/local-tools/scheduled-work/${scheduledWork.id}/runs`,
    "POST",
    {
      idempotencyKey: "manual-check",
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.queued.at(-1)?.triggerId, "manual:manual-check");
});

void test("local webhook delivery validates its secret and deduplicates provider retries", async () => {
  const state = fixture();
  const created = await state.call("/local-tools/scheduled-work", "POST", {
    ...createBody,
    operationKey: "github-pull-request-hook",
    trigger: { type: "webhook" },
  });
  const scheduledWork = (
    created.value as { scheduledWork: RecurringWorkRecord }
  ).scheduledWork;
  const stored = storedWork(state, scheduledWork.id);
  state.work.set(scheduledWork.id, {
    ...stored,
    status: "active",
    grant: {
      version: 1,
      approvedAt: 1,
      toolPatterns: stored.proposedToolPatterns,
    },
  });
  const secret = "local-hook-secret";
  state.webhookHashes.set(
    scheduledWork.id,
    createHash("sha256").update(secret).digest("hex"),
  );
  const rejected = await handleScheduledWorkWebhook({
    path: `/hooks/scheduled-runs/${scheduledWork.id}/wrong`,
    body: {},
    idempotencyKey: "delivery-1",
    manager: state.manager as never,
    runner: state.runner,
  });
  assert.equal(rejected.status, 404);
  const accepted = await handleScheduledWorkWebhook({
    path: `/hooks/scheduled-runs/${scheduledWork.id}/${secret}`,
    body: { action: "opened", pullRequest: 42 },
    idempotencyKey: "delivery-1",
    manager: state.manager as never,
    runner: state.runner,
  });
  assert.equal(accepted.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.queued.at(-1)?.triggerId, "webhook:delivery-1");
  assert.deepEqual(state.queued.at(-1)?.context?.payload, {
    action: "opened",
    pullRequest: 42,
  });

  const tooLong = await handleScheduledWorkWebhook({
    path: `/hooks/scheduled-runs/${scheduledWork.id}/${secret}`,
    body: {},
    idempotencyKey: "x".repeat(161),
    manager: state.manager as never,
    runner: state.runner,
  });
  assert.equal(tooLong.status, 400);

  state.work.set(scheduledWork.id, {
    ...storedWork(state, scheduledWork.id),
    trigger: { type: "once", at: Date.now() + 60_000 },
  });
  const staleSecret = await handleScheduledWorkWebhook({
    path: `/hooks/scheduled-runs/${scheduledWork.id}/${secret}`,
    body: {},
    idempotencyKey: "delivery-2",
    manager: state.manager as never,
    runner: state.runner,
  });
  assert.equal(staleSecret.status, 404);
});

void test("channel triggers default to human messages and preserve the source event", async () => {
  const state = fixture();
  const created = await state.call(
    "/local-tools/scheduled-work",
    "POST",
    createBody,
  );
  const scheduledWork = (
    created.value as { scheduledWork: RecurringWorkRecord }
  ).scheduledWork;
  const stored = storedWork(state, scheduledWork.id);
  state.work.set(scheduledWork.id, {
    ...stored,
    status: "active",
    grant: {
      version: 1,
      approvedAt: 1,
      toolPatterns: stored.proposedToolPatterns,
    },
  });
  const event = {
    protocol: "nip29" as const,
    id: "event-human-1",
    channelId: "engineering",
    kind: 9 as const,
    pubkey: "human",
    tags: [["h", "engineering"]],
    content: "A new pull request is ready",
    actor: { type: "user" as const, id: "workspace-owner", name: "Owner" },
    createdAt: Date.now(),
  };
  await dispatchScheduledWorkEvent({
    workspaceId: "workspace-a",
    event,
    manager: state.manager as never,
    runner: state.runner,
  });
  assert.equal(state.queued.at(-1)?.triggerId, "channel-event:event-human-1");
  assert.equal(state.queued.at(-1)?.context?.eventId, "event-human-1");

  const before = state.queued.length;
  await dispatchScheduledWorkEvent({
    workspaceId: "workspace-a",
    event: {
      ...event,
      id: "event-agent-1",
      actor: { type: "agent", id: "engineer", name: "Engineer" },
    },
    manager: state.manager as never,
    runner: state.runner,
  });
  assert.equal(state.queued.length, before);
});
