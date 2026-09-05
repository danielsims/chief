import { expect, it } from "vitest";

import type { JsonObject } from "@chief/relay-contracts";
import { missionSchema } from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";
import { channelEnvelope, channelRpc, setupChannelTest } from "./channel-test-helpers";

it("persists bounded experiments, rejects false wins, and serializes concurrent retries", async () => {
  const ctx = await setupChannelTest();
  expect((await channelRpc(ctx, ctx.principal, "channels-create", channelEnvelope({ conversationId: "growth-test", name: "growth-test", isPrivate: true }))).status).toBe(201);
  expect((await channelRpc(ctx, ctx.principal, "channels-members-add", channelEnvelope({ conversationId: "growth-test", kind: "agent", principalId: "chief" }))).status).toBe(200);
  const rpc = (operation: string, body: JsonObject) => ctx.env.WORKSPACES.get(ctx.env.WORKSPACES.idFromName(ctx.workspaceId)).fetch(withTrustedContext(new Request("https://workspace.internal", {
    method: "POST",
    headers: { "content-type": "application/json", "x-chief-internal-operation": operation, "x-chief-mission-id": "growth-mission" },
    body: JSON.stringify(body),
  }), { principal: ctx.principal, workspaceId: ctx.workspaceId, requestId: crypto.randomUUID() }));
  const created = await rpc("missions-create", {
    id: "growth-mission", conversationId: "growth-test", title: "Improve qualified signups", objective: "Improve signup conversion with one controlled landing-page change.", ownerAgentId: "chief", collaborators: [],
    success: { kind: "metric", name: "Signup conversion", unit: "%", direction: "increase", baseline: 2, target: 4, source: "Product analytics signup report", evaluationWindow: "Seven days, same acquisition cohort" },
    maxExperiments: 2, deadline: new Date(Date.now() + 86_400_000).toISOString(), constraints: "Draft changes only. No spend or publishing.",
  });
  expect(created.status).toBe(200);
  expect((await rpc("missions-status", { status: "completed", evidence: "Looks good" })).status).toBe(409);
  const experiment = { id: "experiment-one", hypothesis: "Clearer positioning improves signups", change: "Draft a more specific headline", value: 1, evidence: "Report shows a decline in the matched cohort", decision: "keep" };
  expect((await rpc("missions-experiment", experiment)).status).toBe(400);
  const retries = await Promise.all([rpc("missions-experiment", { ...experiment, value: 3 }), rpc("missions-experiment", { ...experiment, value: 3 })]);
  for (const response of retries) expect(missionSchema.parse(await response.json()).experiments).toHaveLength(1);
  const final = await rpc("missions-experiment", { ...experiment, id: "experiment-two", decision: "inconclusive", value: null, evidence: "Not enough observations" });
  const mission = missionSchema.parse(await final.json());
  expect(mission.experiments).toHaveLength(2);
  expect(mission.status).toBe("paused");
  expect((await rpc("missions-status", { status: "active", evidence: "Continue" })).status).toBe(409);
  expect((await rpc("missions-experiment", { ...experiment, id: "experiment-three", value: 5 })).status).toBe(409);
});
