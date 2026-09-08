import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { workspaceScheduleSchema } from "@chief/relay-contracts";

import { initializeWorkspaceSchema } from "../src/db/migrations/workspace";
import { insertDeliveryExternalAgentOutbox } from "../src/queries/external-agent-outbox/insert-delivery";
import { runWorkspaceAlarm } from "../src/workspace-alarm";
import { listScheduleRuns } from "../src/workspace-schedule-runs";
import {
  ensureWorkspaceAlarm,
  readWorkspaceSchedule,
  wakeWorkspaceSchedules,
  writeWorkspaceSchedule,
} from "../src/workspace-schedule-store";
import { channelRpc, setupChannelTest } from "./channel-test-helpers";

async function setup(nextAt = Date.now() + 86_400_000) {
  const ctx = await setupChannelTest();
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const schedule = workspaceScheduleSchema.parse({
    id: "daily-marketing",
    conversationId: "missing-channel",
    agentId: "chief",
    title: "Daily marketing",
    instructions: "Create a draft.",
    cron: "7 10 * * *",
    timezone: "Australia/Brisbane",
    status: "active",
    placement: "cloud",
    nextAt,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await runInDurableObject(stub, async (_instance, state) => {
    writeWorkspaceSchedule(state.storage, {
      schedule,
      approvedBy: ctx.principal,
    });
    await state.storage.deleteAlarm();
  });
  return { ctx, stub, schedule };
}

describe("workspace alarm recovery", () => {
  it("restores a missing alarm without changing the persisted schedule", async () => {
    const { stub, schedule } = await setup();
    await runInDurableObject(stub, async (_instance, state) => {
      await ensureWorkspaceAlarm(state.storage);
      expect(await state.storage.getAlarm()).toBe(schedule.nextAt);
      expect(
        readWorkspaceSchedule(state.storage, schedule.id)?.schedule,
      ).toEqual(schedule);
      await state.storage.deleteAlarm();
    });
  });
  it("leaves an existing imminent alarm untouched during recovery", async () => {
    const { stub } = await setup();
    await runInDurableObject(stub, async (_instance, state) => {
      const earlier = Date.now() + 60_000;
      await state.storage.setAlarm(earlier);
      await ensureWorkspaceAlarm(state.storage);
      expect(await state.storage.getAlarm()).toBe(earlier);
      await state.storage.deleteAlarm();
    });
  });
  it("repairs a missing alarm when the calendar is read", async () => {
    const { ctx, stub, schedule } = await setup();
    expect(
      (await channelRpc(ctx, ctx.principal, "schedules-list")).status,
    ).toBe(200);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBe(schedule.nextAt);
      await state.storage.deleteAlarm();
    });
  });
  it("records a missed occurrence once and retains tomorrow's alarm after cleanup", async () => {
    const { ctx, stub, schedule } = await setup(Date.now() - 60_000);
    await runInDurableObject(stub, async (_instance, state) => {
      await runWorkspaceAlarm(state.storage, ctx.env);
      const runs = listScheduleRuns(state.storage, schedule.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.scheduledAt).toBe(schedule.nextAt);
      expect(runs[0]?.source).toBe("cron");
      // A newly queued run may be due just after the first alarm's captured time.
      await runWorkspaceAlarm(state.storage, ctx.env);
      // A channel that no longer exists blocks work, but never erases the occurrence.
      expect(listScheduleRuns(state.storage, schedule.id)[0]?.state).toBe(
        "blocked",
      );
      await runWorkspaceAlarm(state.storage, ctx.env);
      expect(listScheduleRuns(state.storage, schedule.id)).toHaveLength(1);
      const nextAt = readWorkspaceSchedule(state.storage, schedule.id)?.schedule
        .nextAt;
      expect(nextAt).toBeGreaterThan(Date.now());
      expect(await state.storage.getAlarm()).toBe(nextAt);
      await state.storage.deleteAlarm();
    });
  });
  it("records due work and retains a retry when the outbox cannot be read", async () => {
    const { ctx, stub, schedule } = await setup(Date.now() - 60_000);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("DROP TABLE external_agent_outbox");
      try {
        const before = Date.now();
        await expect(
          runWorkspaceAlarm(state.storage, ctx.env),
        ).rejects.toThrow();
        expect(listScheduleRuns(state.storage, schedule.id)).toHaveLength(1);
        expect(await state.storage.getAlarm()).toBeGreaterThanOrEqual(
          before + 60_000,
        );
      } finally {
        initializeWorkspaceSchema(state.storage, ctx.env);
        await state.storage.deleteAlarm();
      }
    });
  });
  it("recovers an earlier external delivery instead of postponing it to tomorrow", async () => {
    const { stub } = await setup();
    await runInDurableObject(stub, async (_instance, state) => {
      const next = Date.now() + 60_000;
      const now = new Date().toISOString();
      insertDeliveryExternalAgentOutbox(state.storage, {
        agentId: "chief",
        deliveryId: "pending",
        payloadHash: "hash",
        payloadJson: "{}",
        capabilityHash: "hash",
        conversationId: "missing-channel",
        threadRootId: null,
        sessionAddress: "test",
        nextAttemptAt: new Date(next).toISOString(),
        createdAt: now,
        updatedAt: now,
      });
      await ensureWorkspaceAlarm(state.storage);
      expect(await state.storage.getAlarm()).toBe(next);
      await state.storage.deleteAlarm();
    });
  });
  it("clears a stale recovery alarm when no work remains", async () => {
    const { stub, schedule } = await setup();
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = readWorkspaceSchedule(state.storage, schedule.id);
      if (!stored) throw new Error("Expected the persisted schedule.");
      stored.schedule.status = "paused";
      writeWorkspaceSchedule(state.storage, stored);
      await state.storage.setAlarm(Date.now() + 60_000);
      await wakeWorkspaceSchedules(state.storage);
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });
});
