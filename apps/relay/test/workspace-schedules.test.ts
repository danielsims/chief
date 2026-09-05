import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { JsonObject } from "@chief/relay-contracts";
import {
  directStartResultSchema,
  workspaceScheduleSchema,
  workspaceSchedulesResultSchema,
} from "@chief/relay-contracts";

import type { WorkspaceObject } from "../src/workspace-object";
import { withTrustedContext } from "../src/internal-context";
import {
  drainWorkspaceSchedules,
  enqueueScheduleOccurrence,
} from "../src/workspace-schedule-dispatch";
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

async function setup() {
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
            "SELECT state FROM workspace_schedule_dispatches",
          ),
        ];
        expect(rows).toEqual([{ state: "sent" }]);
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
        kind: "conversation.message",
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
      ...state.storage.sql.exec(
        "SELECT state FROM workspace_schedule_dispatches",
      ),
    ]).toEqual([{ state: "cancelled" }]);
    expect(
      readWorkspaceSchedule(state.storage, input.id)?.schedule.status,
    ).toBe("paused");
  });
});
