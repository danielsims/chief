import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { JsonObject } from "@chief/relay-contracts";
import {
  agentIdSchema,
  directStartResultSchema,
  scheduleWebhookSecretSchema,
  workspaceScheduleSchema,
  workspaceSchedulesResultSchema,
} from "@chief/relay-contracts";

import type { WorkspaceObject } from "../src/workspace-object";
import { withTrustedContext } from "../src/internal-context";
import {
  drainWorkspaceSchedules,
  enqueueScheduleOccurrence,
} from "../src/workspace-schedule-dispatch";
import { readScheduleRun } from "../src/workspace-schedule-runs";
import {
  nextScheduleTime,
  readWorkspaceSchedule,
} from "../src/workspace-schedule-store";
import {
  agentId,
  channelEnvelope,
  channelRpc,
  registerTestAgent,
  setupChannelTest,
  testAgentPrincipal,
  testConversationMessages,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

async function setup(extraPermissions: string[] = []) {
  const ctx = await setupChannelTest();
  const pubkey = hexKey("scheduled-worker");
  await registerTestAgent(ctx, agentId, pubkey);
  await channelRpc(ctx, ctx.principal, "agent-config-set", {
    agentId,
    config: {
      enabled: true,
      deploymentTarget: "phone",
      inference: { provider: "opencode", model: "test" },
      approvals: "auto",
      capabilities: [],
      integrations: [],
      toolPermissions: [
        ...extraPermissions,
        "workspace.read",
        "workspace.write",
        "messages.read",
        "messages.send",
      ],
    },
  });
  const direct = await channelRpc(
    ctx,
    ctx.principal,
    "directs-start",
    channelEnvelope({ participant: { kind: "agent", principalId: agentId } }),
  );
  const conversationId = directStartResultSchema.parse(await direct.json())
    .conversation.id;
  const principal = testAgentPrincipal(ctx, agentId, pubkey);
  const input = {
    id: "weekly-marketing",
    agentId,
    conversationId,
    title: "Review the marketing experiment",
    instructions:
      "Compare this week's signups with the baseline and suggest the next experiment.",
    cron: "0 9 * * 1",
    timezone: "Australia/Brisbane",
    approvalSummary: "A weekly review in this channel.",
    proposedToolPatterns: [],
  };
  return { ctx, principal, input };
}

describe("durable relay schedules", () => {
  it("accepts a complete agent-authored webhook proposal without an existing channel", async () => {
    const { ctx, input, principal } = await setup([
      "channels.create",
      "members.manage",
    ]);
    const { conversationId: _source, ...spec } = input;
    const response = await channelRpc(ctx, principal, "schedules-save", {
      ...spec,
      newChannel: {
        name: "growth-experiments",
        inviteUserIds: [ctx.principal.userId],
      },
      triggerMode: "webhook",
      expectedOutcome: "A measured growth experiment",
      constraints: "Draft only",
      maxDurationMinutes: 45,
      skipDates: ["2026-12-25"],
    });
    expect(response.status).toBe(200);
    const schedule = workspaceScheduleSchema.parse(await response.json());
    expect(schedule.status).toBe("needs_approval");
    expect(schedule.expectedOutcome).toBe("A measured growth experiment");
    expect(schedule.maxDurationMinutes).toBe(45);
    expect(schedule.skipDates).toEqual(["2026-12-25"]);
    const missions = await channelRpc(ctx, ctx.principal, "missions-list");
    expect(await missions.text()).toContain(schedule.missionId);
  });

  it("creates the mission channel and team atomically and reuses them on retry", async () => {
    const { ctx, input, principal } = await setup();
    const request = { ...input, newChannel: {}, triggerMode: "webhook" };
    const denied = await channelRpc(ctx, principal, "schedules-save", request);
    expect(denied.status).toBe(403);
    const invalid = await channelRpc(ctx, ctx.principal, "schedules-save", {
      ...request,
      timezone: "Not/A_Timezone",
    });
    expect(invalid.status).toBe(400);
    const channelsBefore = await channelRpc(
      ctx,
      ctx.principal,
      "channels-list",
    );
    const before = await channelsBefore.text();
    expect(before).not.toContain("review-the-marketing-experiment");
    const response = await channelRpc(
      ctx,
      ctx.principal,
      "schedules-save",
      request,
    );
    expect(response.status).toBe(200);
    const schedule = workspaceScheduleSchema.parse(await response.json());
    expect(schedule.conversationId).toMatch(/^mission-/u);
    expect(schedule.missionId).toBe(schedule.conversationId);
    expect(schedule.triggerMode).toBe("webhook");
    expect(schedule.status).toBe("needs_approval");
    const retry = await channelRpc(
      ctx,
      ctx.principal,
      "schedules-save",
      request,
    );
    expect(workspaceScheduleSchema.parse(await retry.json()).updatedAt).toBe(
      schedule.updatedAt,
    );
    const channelsAfter = await channelRpc(ctx, ctx.principal, "channels-list");
    expect(await channelsAfter.text()).toContain(
      "review-the-marketing-experiment",
    );
    const missions = await channelRpc(ctx, ctx.principal, "missions-list");
    expect(await missions.text()).toContain(schedule.missionId);
  });

  it("skips the whole local date for frequent schedules across a daylight-saving transition", () => {
    const schedule = workspaceScheduleSchema.parse({
      id: "frequent",
      conversationId: "marketing",
      agentId: "chief",
      title: "Check progress",
      instructions: "Report progress.",
      cron: "*/5 * * * *",
      timezone: "America/New_York",
      skipDates: ["2026-03-08"],
      status: "active",
      placement: "cloud",
      createdAt: 0,
      updatedAt: 0,
    });
    expect(nextScheduleTime(schedule, Date.parse("2026-03-08T04:59:00Z"))).toBe(
      Date.parse("2026-03-09T04:00:00Z"),
    );
  });

  it("requires user approval, persists the proposal, and delivers each occurrence once into the real agent queue", async () => {
    const { ctx, principal, input } = await setup();
    const saved = await rpc(ctx, principal, "schedules-save", input);
    expect(saved.status).toBe(200);
    expect(workspaceScheduleSchema.parse(await saved.json()).status).toBe(
      "needs_approval",
    );
    const denied = await rpc(
      ctx,
      principal,
      "schedules-action",
      { action: "approve", commandId: crypto.randomUUID() },
      input.id,
    );
    expect(denied.status).toBe(403);
    const approved = await rpc(
      ctx,
      ctx.principal,
      "schedules-action",
      { action: "approve", commandId: crypto.randomUUID() },
      input.id,
    );
    expect(approved.status).toBe(200);
    const stub = ctx.env.WORKSPACES.get(
      ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
    );
    await runInDurableObject(
      stub,
      async (_instance: WorkspaceObject, state) => {
        const stored = readWorkspaceSchedule(state.storage, input.id);
        if (!stored) throw new Error("Expected the approved schedule.");
        enqueueScheduleOccurrence(
          state.storage,
          stored.schedule,
          Date.now(),
          "occurrence-1",
        );
        enqueueScheduleOccurrence(
          state.storage,
          stored.schedule,
          Date.now(),
          "occurrence-1",
        );
        await state.storage.deleteAlarm();
      },
    );
    await runInDurableObject(
      stub,
      async (_instance: WorkspaceObject, state) => {
        await drainWorkspaceSchedules(state.storage, ctx.env);
        await drainWorkspaceSchedules(state.storage, ctx.env);
        const rows = [
          ...state.storage.sql.exec(
            "SELECT state FROM workspace_schedule_runs",
          ),
        ];
        expect(rows).toEqual([{ state: "running" }]);
      },
    );
    const messages = await testConversationMessages(
      ctx,
      ctx.principal,
      input.conversationId,
    );
    expect(
      messages.filter((message) => message.body.includes(input.title)),
    ).toHaveLength(1);
    const agent = ctx.env.AGENTS.get(
      ctx.env.AGENTS.idFromName(`${ctx.workspaceId}:${agentId}`),
    );
    const claim = await agent.fetch(
      withTrustedContext(
        new Request("https://agent.internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workerId: "schedule-test", leaseSeconds: 60 }),
        }),
        {
          principal,
          requestId: crypto.randomUUID(),
          workspaceId: ctx.workspaceId,
        },
      ),
    );
    expect(await claim.json()).toMatchObject({
      job: {
        kind: "schedule.step",
        payload: {
          conversationId: input.conversationId,
          instruction: expect.stringContaining(input.instructions),
        },
      },
    });
  });

  it("invalidates approval when an agent changes the instructions, and pause removes future wakeups", async () => {
    const { ctx, principal, input } = await setup();
    await rpc(ctx, principal, "schedules-save", input);
    await rpc(
      ctx,
      ctx.principal,
      "schedules-action",
      { action: "approve", commandId: crypto.randomUUID() },
      input.id,
    );
    const revised = await rpc(ctx, principal, "schedules-save", {
      ...input,
      instructions: "A different task.",
    });
    expect(workspaceScheduleSchema.parse(await revised.json()).status).toBe(
      "needs_approval",
    );
    const staleApproval = await rpc(
      ctx,
      ctx.principal,
      "schedules-action",
      {
        action: "approve",
        commandId: crypto.randomUUID(),
        expectedUpdatedAt: 0,
      },
      input.id,
    );
    expect(staleApproval.status).toBe(409);
    const denied = await rpc(
      ctx,
      ctx.principal,
      "schedules-action",
      { action: "run", commandId: crypto.randomUUID() },
      input.id,
    );
    expect(denied.status).toBe(409);
    await rpc(
      ctx,
      ctx.principal,
      "schedules-action",
      { action: "approve", commandId: crypto.randomUUID() },
      input.id,
    );
    const paused = await rpc(
      ctx,
      ctx.principal,
      "schedules-action",
      { action: "pause", commandId: crypto.randomUUID() },
      input.id,
    );
    expect(workspaceScheduleSchema.parse(await paused.json())).toMatchObject({
      status: "paused",
      upcomingRuns: [],
    });
    const stub = ctx.env.WORKSPACES.get(
      ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
    );
    await runInDurableObject(stub, (_instance: WorkspaceObject, state) => {
      expect([
        ...state.storage.sql.exec("SELECT next_at FROM workspace_schedules"),
      ]).toEqual([{ next_at: null }]);
    });
  });
});

async function rpc(
  ctx: Awaited<ReturnType<typeof setupChannelTest>>,
  principal: Parameters<typeof withTrustedContext>[1]["principal"],
  operation: string,
  body: JsonObject,
  id?: string,
) {
  if (body.action === "approve" && body.expectedUpdatedAt === undefined) {
    const listed = await rpc(ctx, ctx.principal, "schedules-list", {});
    const current = workspaceSchedulesResultSchema
      .parse(await listed.json())
      .schedules.find((schedule) => schedule.id === id);
    body = { ...body, expectedUpdatedAt: current?.updatedAt ?? 0 };
  }
  return ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": operation,
          ...(id ? { "x-chief-schedule-id": id } : undefined),
        },
        body: JSON.stringify(body),
      }),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      },
    ),
  );
}

it("cancels queued iterations after their mission is paused", async () => {
  const { ctx, input } = await setup();
  const missionId = "bounded-growth";
  expect(
    (
      await channelRpc(ctx, ctx.principal, "missions-create", {
        id: missionId,
        conversationId: input.conversationId,
        ownerAgentId: input.agentId,
        title: "Learn which positioning works",
        objective: "Draft and evaluate positioning",
        collaborators: [],
        success: {
          kind: "deliverable",
          description: "A reviewed campaign brief",
        },
        maxExperiments: 3,
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
        constraints: "No publishing",
      })
    ).status,
  ).toBe(200);
  expect(
    (await rpc(ctx, ctx.principal, "schedules-save", { ...input, missionId }))
      .status,
  ).toBe(200);
  expect(
    (
      await rpc(
        ctx,
        ctx.principal,
        "schedules-action",
        { action: "approve", commandId: crypto.randomUUID() },
        input.id,
      )
    ).status,
  ).toBe(200);
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  await runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
    const stored = readWorkspaceSchedule(state.storage, input.id);
    if (!stored) throw new Error("Expected schedule");
    enqueueScheduleOccurrence(
      state.storage,
      stored.schedule,
      Date.now(),
      "paused-occurrence",
    );
    await state.storage.deleteAlarm();
  });
  const paused = await stub.fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "missions-status",
          "x-chief-mission-id": missionId,
        },
        body: JSON.stringify({
          status: "paused",
          evidence: "Owner paused the campaign",
        }),
      }),
      {
        principal: ctx.principal,
        workspaceId: ctx.workspaceId,
        requestId: crypto.randomUUID(),
      },
    ),
  );
  expect(paused.status).toBe(200);
  await runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
    await drainWorkspaceSchedules(state.storage, ctx.env);
    expect([
      ...state.storage.sql.exec("SELECT state FROM workspace_schedule_runs"),
    ]).toEqual([{ state: "cancelled" }]);
    expect(
      readWorkspaceSchedule(state.storage, input.id)?.schedule.status,
    ).toBe("paused");
  });
});

it("authenticates and deduplicates webhook deliveries before dispatching work", async () => {
  const { ctx, input } = await setup();
  await rpc(ctx, ctx.principal, "schedules-save", {
    ...input,
    triggerMode: "webhook",
  });
  await rpc(
    ctx,
    ctx.principal,
    "schedules-action",
    { action: "approve", commandId: crypto.randomUUID() },
    input.id,
  );
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const created = await stub.fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "webhooks-create",
          "x-chief-public-origin": "https://relay.test",
        },
        body: JSON.stringify({
          name: "Campaign results",
          scheduleId: input.id,
        }),
      }),
      {
        principal: ctx.principal,
        workspaceId: ctx.workspaceId,
        requestId: crypto.randomUUID(),
      },
    ),
  );
  const { webhook, secret } = scheduleWebhookSecretSchema.parse(
    await created.json(),
  );
  if (!secret) throw new Error("Expected signing secret");
  const deliveryId = crypto.randomUUID();
  const body = JSON.stringify({ signups: 42 });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sign = async (payload: string) =>
    btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(`${deliveryId}.${timestamp}.${payload}`),
          ),
        ),
      ),
    );
  const signature = await sign(body);
  const deliver = (payload = body, signed = signature) =>
    stub.fetch(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "webhooks-deliver",
          "x-chief-workspace-id": ctx.workspaceId,
          "x-chief-webhook-id": webhook.id,
          "webhook-id": deliveryId,
          "webhook-timestamp": timestamp,
          "webhook-signature": `v1,${signed}`,
        },
        body: payload,
      }),
    );
  expect((await deliver(body, "invalid")).status).toBe(401);
  expect((await deliver('{"signups":999}')).status).toBe(401);
  const accepted = await deliver();
  expect(accepted.status).toBe(202);
  const receipt = (await accepted.json()) as { runId: string };
  expect(await (await deliver()).json()).toMatchObject({
    runId: receipt.runId,
    duplicate: true,
  });
  expect(
    (await deliver('{"signups":999}', await sign('{"signups":999}'))).status,
  ).toBe(409);
  await runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
    const run = readScheduleRun(state.storage, receipt.runId)?.run;
    expect(run?.input).toEqual({ signups: 42 });
    expect(run?.schedule.triggerMode).toBe("webhook");
    expect(
      state.storage.sql
        .exec("SELECT id FROM workspace_schedule_runs")
        .toArray(),
    ).toHaveLength(1);
    await state.storage.deleteAlarm();
  });
});

it("waits for each phase's durable result before handing work to the next teammate", async () => {
  const { ctx, principal, input } = await setup();
  const teammate = agentIdSchema.parse("researcher");
  const teammateKey = hexKey("scheduled-researcher");
  await registerTestAgent(ctx, teammate, teammateKey);
  await channelRpc(ctx, ctx.principal, "agent-config-set", {
    agentId: teammate,
    config: {
      enabled: true,
      deploymentTarget: "phone",
      inference: { provider: "opencode", model: "test" },
      approvals: "auto",
      capabilities: [],
      integrations: [],
      toolPermissions: [
        "workspace.read",
        "workspace.write",
        "messages.read",
        "messages.send",
      ],
    },
  });
  await channelRpc(
    ctx,
    ctx.principal,
    "channels-create",
    channelEnvelope({
      conversationId: "scheduled-team",
      name: "scheduled-team",
      isPrivate: false,
    }),
  );
  for (const id of [agentId, teammate])
    await channelRpc(
      ctx,
      ctx.principal,
      "channels-members-add",
      channelEnvelope({
        conversationId: "scheduled-team",
        kind: "agent",
        principalId: id,
      }),
    );
  expect(
    (
      await rpc(ctx, ctx.principal, "schedules-save", {
        ...input,
        conversationId: "scheduled-team",
        collaborators: [teammate],
        triggerMode: "webhook",
      })
    ).status,
  ).toBe(200);
  await rpc(
    ctx,
    ctx.principal,
    "schedules-action",
    { action: "approve", commandId: crypto.randomUUID() },
    input.id,
  );
  const runId = crypto.randomUUID();
  await rpc(
    ctx,
    ctx.principal,
    "schedules-action",
    { action: "run", commandId: runId },
    input.id,
  );
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const drain = () =>
    runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
      state.storage.sql.exec(
        "UPDATE workspace_schedule_runs SET next_check_at = 0 WHERE state IN ('queued','running')",
      );
      await drainWorkspaceSchedules(state.storage, ctx.env);
      await state.storage.deleteAlarm();
      return readScheduleRun(state.storage, runId)?.run;
    });
  const initial = await drain();
  expect(initial?.steps.map((step) => step.state)).toEqual([
    "running",
    "pending",
    "pending",
  ]);
  for (const [index, id] of [agentId, teammate, agentId].entries()) {
    const actor =
      id === teammate
        ? testAgentPrincipal(ctx, teammate, teammateKey)
        : principal;
    const agentRpc = (path: string, payload: JsonObject) =>
      ctx.env.AGENTS.get(
        ctx.env.AGENTS.idFromName(`${ctx.workspaceId}:${id}`),
      ).fetch(
        withTrustedContext(
          new Request(`https://agent.internal/${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }),
          {
            principal: actor,
            workspaceId: ctx.workspaceId,
            requestId: crypto.randomUUID(),
          },
        ),
      );
    const claimed = await agentRpc("claim", {
      workerId: "team-test",
      leaseSeconds: 60,
    });
    const lease = (await claimed.json()) as {
      leaseToken: string;
      job: { payload: { scheduleStepId: string } };
    };
    expect(lease.job.payload.scheduleStepId).toBe(initial?.steps[index]?.id);
    const complete = await agentRpc("complete", {
      leaseToken: lease.leaseToken,
      outcome: {
        status: "completed",
        result: {
          publishedMessage: {
            conversationId: "scheduled-team",
            threadRootId: initial?.threadRootId ?? "",
            body: `Evidence from phase ${index}`,
          },
        },
      },
    });
    expect(complete.status, await complete.clone().text()).toBe(200);
    const next = await drain();
    expect(
      next?.steps
        .slice(0, index + 1)
        .every((step) => step.state === "completed"),
    ).toBe(true);
    if (index < 2) expect(next?.steps[index + 1]?.state).toBe("running");
    else expect(next?.state).toBe("completed");
  }
});
it("retains recorded calendar occurrences after a run starts and its schedule is paused", async () => {
  const { ctx, input } = await setup();
  await rpc(ctx, ctx.principal, "schedules-save", input);
  await rpc(
    ctx,
    ctx.principal,
    "schedules-action",
    { action: "approve", commandId: crypto.randomUUID() },
    input.id,
  );
  const at = Date.now() - 60_000;
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  await runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
    const stored = readWorkspaceSchedule(state.storage, input.id);
    if (!stored) throw new Error("Expected schedule");
    enqueueScheduleOccurrence(
      state.storage,
      stored.schedule,
      at,
      "calendar-history",
    );
    await state.storage.deleteAlarm();
  });
  await rpc(
    ctx,
    ctx.principal,
    "schedules-action",
    { action: "pause", commandId: crypto.randomUUID() },
    input.id,
  );
  const list = async (from: number, to: number) => {
    const response = await channelRpc(
      ctx,
      ctx.principal,
      "schedules-list",
      undefined,
      `from=${from}&to=${to}`,
    );
    return workspaceSchedulesResultSchema.parse(await response.json())
      .schedules[0];
  };
  const schedule = await list(at - 1, at + 1);
  expect(schedule?.recordedRuns).toEqual([at]);
  expect(schedule?.upcomingRuns).toEqual([]);
  expect((await list(at + 1, at + 60_000))?.recordedRuns).toEqual([]);
});
