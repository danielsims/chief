import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

import {
  agentIdSchema,
  scheduleRunSchema,
  workspaceScheduleSchema,
} from "@chief/relay-contracts";

import type { WorkspaceObject } from "../src/workspace-object";
import { drainWorkspaceSchedules } from "../src/workspace-schedule-dispatch";
import {
  queueScheduleRun,
  readScheduleRun,
  writeScheduleRun,
} from "../src/workspace-schedule-runs";
import {
  readWorkspaceSchedule,
  writeWorkspaceSchedule,
} from "../src/workspace-schedule-store";
import {
  channelEnvelope,
  channelRpc,
  setupChannelTest,
  testAgentPrincipal,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

async function fixture() {
  const ctx = await setupChannelTest();
  for (const id of ["chief", "brand"]) {
    expect(
      (
        await channelRpc(ctx, ctx.principal, "agent-config-set", {
          agentId: id,
          config: {
            enabled: true,
            deploymentTarget: "phone",
            messageAccess: "workspace",
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
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await channelRpc(
          ctx,
          ctx.principal,
          "channels-members-add",
          channelEnvelope({
            conversationId: "mission-control",
            kind: "agent",
            principalId: id,
          }),
        )
      ).status,
    ).toBe(200);
  }
  const saved = await channelRpc(ctx, ctx.principal, "schedules-save", {
    id: "expand-team",
    agentId: "chief",
    collaborators: [],
    conversationId: "mission-control",
    title: "Create a campaign",
    instructions: "Save a useful campaign artifact",
    triggerMode: "webhook",
    timezone: "UTC",
  });
  const schedule = workspaceScheduleSchema.parse(await saved.json());
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const run = await runInDurableObject(
    stub,
    (_instance: WorkspaceObject, state) => {
      const run = queueScheduleRun(state.storage, schedule, ctx.principal, {
        id: crypto.randomUUID(),
        source: "manual",
        scheduledAt: Date.now(),
      });
      run.state = "running";
      const first = run.steps[0];
      if (!first) throw new Error("Expected a lead step");
      first.state = "running";
      writeScheduleRun(state.storage, run, ctx.principal);
      return run;
    },
  );
  const lead = testAgentPrincipal(
    ctx,
    agentIdSchema.parse("chief"),
    hexKey("chief"),
  );
  const input = {
    runId: run.id,
    agentId: "brand",
    assignment: "Save the campaign draft as a channel artifact.",
  };
  const add = (principal = lead, body = input) =>
    channelRpc(ctx, principal, "schedules-runs-add-collaborator", body);
  return { ctx, stub, run, lead, input, add };
}

it("adds one tracked assignment, preserves the in-flight step and leaves the recurring team unchanged", async () => {
  const f = await fixture();
  const response = await f.add();
  expect(response.status, await response.clone().text()).toBe(200);
  const updated = scheduleRunSchema.parse(await response.json());
  expect(
    updated.steps.map((step) => [step.agentId, step.phase, step.state]),
  ).toEqual([
    ["chief", "plan", "running"],
    ["brand", "contribute", "pending"],
    ["chief", "finish", "pending"],
  ]);
  expect(updated.steps[0]?.id).toBe(f.run.steps[0]?.id);
  expect(updated.steps[1]?.assignment).toBe(f.input.assignment);
  expect(updated.schedule.collaborators).toEqual(["brand"]);
  const replay = scheduleRunSchema.parse(await (await f.add()).json());
  expect(replay.steps).toEqual(updated.steps);
  expect(
    (await f.add(f.lead, { ...f.input, assignment: "Different work" })).status,
  ).toBe(409);
  const stored = await runInDurableObject(
    f.stub,
    (_instance: WorkspaceObject, state) =>
      readWorkspaceSchedule(state.storage, "expand-team")?.schedule,
  );
  expect(stored?.collaborators).toEqual([]);
});

it("rejects another agent and ended runs without changing the team", async () => {
  const f = await fixture();
  const other = testAgentPrincipal(
    f.ctx,
    agentIdSchema.parse("brand"),
    hexKey("brand"),
  );
  expect((await f.add(other)).status).toBe(403);
  await runInDurableObject(f.stub, (_instance: WorkspaceObject, state) => {
    const stored = readScheduleRun(state.storage, f.run.id);
    if (!stored) throw new Error("Expected stored run");
    stored.run.state = "completed";
    writeScheduleRun(state.storage, stored.run, stored.principal);
  });
  expect((await f.add()).status).toBe(409);
});

it("keeps personal sharing permissions and rolls back an unavailable assignment", async () => {
  const f = await fixture();
  expect(
    (
      await channelRpc(f.ctx, f.ctx.principal, "agent-config-set", {
        agentId: "brand",
        config: {
          enabled: true,
          deploymentTarget: "phone",
          messageAccess: "owner",
          inference: { provider: "opencode", model: "test" },
          approvals: "auto",
          capabilities: [],
          integrations: [],
          toolPermissions: ["workspace.read", "messages.read", "messages.send"],
        },
      })
    ).status,
  ).toBe(200);
  expect((await f.add()).status).toBe(403);
  const stored = await runInDurableObject(
    f.stub,
    (_instance: WorkspaceObject, state) =>
      readScheduleRun(state.storage, f.run.id)?.run,
  );
  expect(stored?.steps).toEqual(f.run.steps);
  expect(stored?.schedule.collaborators).toEqual([]);
});

it("dispatches the added agent after the lead completes, before the final review", async () => {
  const f = await fixture();
  await runInDurableObject(f.stub, (_instance: WorkspaceObject, state) => {
    const stored = readWorkspaceSchedule(state.storage, "expand-team");
    if (!stored) throw new Error("Expected schedule");
    writeWorkspaceSchedule(state.storage, {
      ...stored,
      approvedBy: f.ctx.principal,
    });
  });
  expect((await f.add()).status).toBe(200);
  const first = f.run.steps[0];
  if (!first) throw new Error("Expected lead step");
  const reported = await channelRpc(f.ctx, f.lead, "schedules-runs-report", {
    runId: f.run.id,
    stepId: first.id,
    status: "completed",
    evidence: "Assigned the campaign draft.",
  });
  expect(reported.status, await reported.clone().text()).toBe(200);
  const run = await runInDurableObject(
    f.stub,
    async (_instance: WorkspaceObject, state) => {
      await drainWorkspaceSchedules(state.storage, f.ctx.env);
      return readScheduleRun(state.storage, f.run.id)?.run;
    },
  );
  expect(run?.steps.map((step) => [step.agentId, step.state])).toEqual([
    ["chief", "completed"],
    ["brand", "running"],
    ["chief", "pending"],
  ]);
});
