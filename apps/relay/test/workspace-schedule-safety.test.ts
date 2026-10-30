import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

import { workspaceScheduleSchema } from "@chief/relay-contracts";

import type { WorkspaceObject } from "../src/workspace-object";
import { withTrustedContext } from "../src/internal-context";
import { drainWorkspaceSchedules } from "../src/workspace-schedule-dispatch";
import { readScheduleRun } from "../src/workspace-schedule-runs";
import { readWorkspaceSchedule } from "../src/workspace-schedule-store";
import { agentId, channelRpc } from "./channel-test-helpers";
import { setupScheduleTest } from "./workspace-schedule-test-helpers";

it("lets a team agent dispatch its own pre-approval test without administrator privileges", async () => {
  const { ctx, principal, input } = await setupScheduleTest();
  const saved = await channelRpc(ctx, principal, "schedules-save", {
    ...input,
    triggerMode: "webhook",
    automation: {
      version: 1,
      steps: [
        {
          id: "research",
          type: "agent",
          agentId,
          title: "Research",
          prompt: "Read the available evidence",
        },
      ],
    },
  });
  expect(saved.status).toBe(200);
  const tested = await channelRpc(ctx, principal, "automations-test", {
    id: input.id,
  });
  expect(tested.status).toBe(200);
  const { runId } = (await tested.json()) as { runId: string };
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const run = await runInDurableObject(
    stub,
    async (_instance: WorkspaceObject, state) => {
      await drainWorkspaceSchedules(state.storage, ctx.env);
      return readScheduleRun(state.storage, runId)?.run;
    },
  );
  expect(run?.state).toBe("running");
  expect(run?.steps[0]?.state).toBe("running");
  expect(run?.summary).not.toContain("owner or admin");
});

it("rejects stale schedule saves without overwriting the latest definition", async () => {
  const { ctx, input, principal } = await setupScheduleTest();
  const first = await channelRpc(ctx, principal, "schedules-save", input);
  const saved = workspaceScheduleSchema.parse(await first.json());
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const save = (revision: number, instructions: string) =>
    stub.fetch(
      withTrustedContext(
        new Request("https://workspace.internal", {
          method: "POST",
          headers: {
            "x-chief-internal-operation": "schedules-save",
            "content-type": "application/json",
            "if-match": `"${revision}"`,
          },
          body: JSON.stringify({ ...input, instructions }),
        }),
        {
          principal,
          workspaceId: ctx.workspaceId,
          requestId: crypto.randomUUID(),
        },
      ),
    );
  const updated = await save(saved.updatedAt, "The latest brief");
  expect(updated.status).toBe(200);
  const stale = await save(saved.updatedAt, "An obsolete brief");
  expect(stale.status).toBe(412);
  const latest = await runInDurableObject(
    stub,
    (_instance: WorkspaceObject, state) =>
      readWorkspaceSchedule(state.storage, input.id),
  );
  expect(latest?.schedule.instructions).toBe("The latest brief");
});
