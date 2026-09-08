import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";
import {
  externalAgentDeliveryCommandSchema,
  parseJsonObject,
  workspaceScheduleSchema,
} from "@chief/relay-contracts";

import type { WorkspaceObject } from "../src/workspace-object";
import { drainExternalAgentOutbox } from "../src/workspace-external-agent-alarm";
import { drainWorkspaceSchedules } from "../src/workspace-schedule-dispatch";
import { readScheduleRun } from "../src/workspace-schedule-runs";
import {
  channelEnvelope,
  channelRpc,
  setupChannelTest,
  testConversationMessages,
} from "./channel-test-helpers";
import {
  receiveExternalAgent,
  registerExternalAgent,
  verifyExternalAgent,
  workspaceFetch,
} from "./external-agent-channel-helpers";

afterEach(() => vi.unstubAllGlobals());

const deliveryEnvironmentSchema = z.object({
  RELAY_SECRET_KEY: z.string().min(1),
});

it("a completion receipt wakes the collaborator without duplicating the lead's published reply", async () => {
  const ctx = await setupChannelTest();
  const registration = await registerExternalAgent(ctx, {
    agentId: "eve-lead",
  });
  await verifyExternalAgent(ctx, "eve-lead");
  await channelRpc(
    ctx,
    ctx.principal,
    "channels-members-add",
    channelEnvelope({
      conversationId: "mission-control",
      kind: "agent",
      principalId: "eve-lead",
    }),
  );
  await channelRpc(ctx, ctx.principal, "agent-config-set", {
    agentId: "chief",
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
  const saved = await channelRpc(ctx, ctx.principal, "schedules-save", {
    id: "handoff",
    agentId: "eve-lead",
    collaborators: ["chief"],
    conversationId: "mission-control",
    title: "Create a campaign",
    instructions: "Create a campaign",
    triggerMode: "webhook",
    timezone: "UTC",
  });
  const schedule = workspaceScheduleSchema.parse(await saved.json());
  const action = (body: JsonObject) =>
    workspaceFetch(
      ctx,
      "schedules-action",
      body,
      ctx.principal,
      "https://relay.test/schedules/handoff/actions",
      { "x-chief-schedule-id": "handoff" },
    );
  expect(
    (
      await action({
        action: "approve",
        expectedUpdatedAt: schedule.updatedAt,
        commandId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  const deliveries: ReturnType<
    typeof externalAgentDeliveryCommandSchema.parse
  >[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const envelope = parseJsonObject(await new Request(input, init).json());
      const payload = parseJsonObject(envelope?.payload);
      if (!envelope || !payload) throw new Error("Expected delivery envelope");
      delete payload.people;
      deliveries.push(
        externalAgentDeliveryCommandSchema.parse({ ...envelope, payload }),
      );
      return Response.json({ status: "accepted", sessionId: "lead-session" });
    }),
  );
  const runId = crypto.randomUUID();
  expect((await action({ action: "run", commandId: runId })).status).toBe(200);
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const deliveryEnv = { ...ctx.env, ...deliveryEnvironmentSchema.parse(env) };
  const drain = () =>
    runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
      state.storage.sql.exec(
        "UPDATE workspace_schedule_runs SET next_check_at = 0 WHERE state = 'running' OR state = 'queued'",
      );
      await drainWorkspaceSchedules(state.storage, deliveryEnv);
      await drainExternalAgentOutbox(state.storage, deliveryEnv);
      return readScheduleRun(state.storage, runId)?.run;
    });
  const initial = await drain();
  expect(initial?.state, JSON.stringify(initial)).toBe("running");
  expect(initial?.steps[0]?.state, JSON.stringify(initial)).toBe("running");
  const outbox = await runInDurableObject(
    stub,
    (_instance: WorkspaceObject, state) =>
      state.storage.sql
        .exec("SELECT status, last_error FROM external_agent_outbox")
        .toArray(),
  );
  expect(deliveries.length, JSON.stringify(outbox)).toBe(1);
  const delivery = deliveries[0];
  if (!delivery) throw new Error("Expected the lead delivery");
  expect(delivery.payload.message.author.kind).toBe("system");
  const base = {
    continuation: delivery.payload.continuation,
    sessionId: "lead-session",
  };
  expect(
    (
      await receiveExternalAgent(ctx, "eve-lead", registration.channel.token, {
        ...base,
        deliveryId: "lead-published-plan",
        body: "Chief, draft the campaign and return the draft here.",
        complete: false,
      })
    ).status,
  ).toBe(200);
  expect((await drain())?.steps.map((step) => step.state)).toEqual([
    "running",
    "pending",
    "pending",
  ]);
  const completed = {
    ...base,
    deliveryId: "lead-completion-receipt",
    body: "",
    publish: false,
    complete: true,
  };
  expect(
    (
      await receiveExternalAgent(
        ctx,
        "eve-lead",
        registration.channel.token,
        completed,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await receiveExternalAgent(
        ctx,
        "eve-lead",
        registration.channel.token,
        completed,
      )
    ).status,
  ).toBe(200);
  expect((await drain())?.steps.map((step) => step.state)).toEqual([
    "completed",
    "running",
    "pending",
  ]);
  const messages = await testConversationMessages(
    ctx,
    ctx.principal,
    "mission-control",
  );
  const announcements = messages.filter((message) =>
    message.components.some((component) => component.kind === "schedule.run"),
  );
  expect(announcements).toHaveLength(1);
  expect(announcements[0]?.author).toEqual({ kind: "system", id: "relay" });
  expect(
    messages.filter((message) => message.body.includes("Chief, draft")),
  ).toHaveLength(1);
  expect(
    messages.some((message) => message.body.includes("Expected result:")),
  ).toBe(false);
  await runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
    await state.storage.deleteAlarm();
  });
});

it("routes the scheduled Marketer step through Chief’s Eve deployment with a child-scoped continuation", async () => {
  const ctx = await setupChannelTest();
  const registration = await registerExternalAgent(ctx, {
    agentId: "chief",
    replaceNative: true,
  });
  await verifyExternalAgent(ctx, "chief");
  await channelRpc(
    ctx,
    ctx.principal,
    "channels-members-add",
    channelEnvelope({
      conversationId: "mission-control",
      kind: "agent",
      principalId: "chief",
    }),
  );
  await channelRpc(
    ctx,
    ctx.principal,
    "channels-members-add",
    channelEnvelope({
      conversationId: "mission-control",
      kind: "agent",
      principalId: "brand",
    }),
  );
  const saved = await channelRpc(ctx, ctx.principal, "schedules-save", {
    id: "handoff",
    agentId: "chief",
    collaborators: ["brand"],
    conversationId: "mission-control",
    title: "Create a campaign",
    instructions: "Create a campaign",
    triggerMode: "webhook",
    timezone: "UTC",
  });
  const schedule = workspaceScheduleSchema.parse(await saved.json());
  const action = (body: JsonObject) =>
    workspaceFetch(
      ctx,
      "schedules-action",
      body,
      ctx.principal,
      "https://relay.test/schedules/handoff/actions",
      { "x-chief-schedule-id": "handoff" },
    );
  expect(
    (
      await action({
        action: "approve",
        expectedUpdatedAt: schedule.updatedAt,
        commandId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  const deliveries: ReturnType<
    typeof externalAgentDeliveryCommandSchema.parse
  >[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const envelope = parseJsonObject(await new Request(input, init).json());
      const payload = parseJsonObject(envelope?.payload);
      if (!envelope || !payload) throw new Error("Expected delivery envelope");
      delete payload.people;
      deliveries.push(
        externalAgentDeliveryCommandSchema.parse({ ...envelope, payload }),
      );
      return Response.json({ status: "accepted", sessionId: "lead-session" });
    }),
  );
  const runId = crypto.randomUUID();
  expect((await action({ action: "run", commandId: runId })).status).toBe(200);
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const deliveryEnv = { ...ctx.env, ...deliveryEnvironmentSchema.parse(env) };
  const drain = () =>
    runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
      state.storage.sql.exec(
        "UPDATE workspace_schedule_runs SET next_check_at = 0 WHERE state = 'running' OR state = 'queued'",
      );
      await drainWorkspaceSchedules(state.storage, deliveryEnv);
      await drainExternalAgentOutbox(state.storage, deliveryEnv);
      return readScheduleRun(state.storage, runId)?.run;
    });
  const initial = await drain();
  expect(initial?.state, JSON.stringify(initial)).toBe("running");
  expect(initial?.steps[0]?.state, JSON.stringify(initial)).toBe("running");
  const outbox = await runInDurableObject(
    stub,
    (_instance: WorkspaceObject, state) =>
      state.storage.sql
        .exec("SELECT status, last_error FROM external_agent_outbox")
        .toArray(),
  );
  expect(deliveries.length, JSON.stringify(outbox)).toBe(1);
  const delivery = deliveries[0];
  if (!delivery) throw new Error("Expected the lead delivery");
  expect(delivery.payload.message.author.kind).toBe("system");
  const base = {
    continuation: delivery.payload.continuation,
    sessionId: "lead-session",
  };
  expect(
    (
      await receiveExternalAgent(ctx, "chief", registration.channel.token, {
        ...base,
        deliveryId: "lead-published-plan",
        body: "Chief, draft the campaign and return the draft here.",
        complete: false,
      })
    ).status,
  ).toBe(200);
  expect((await drain())?.steps.map((step) => step.state)).toEqual([
    "running",
    "pending",
    "pending",
  ]);
  const completed = {
    ...base,
    deliveryId: "lead-completion-receipt",
    body: "",
    publish: false,
    complete: true,
  };
  expect(
    (
      await receiveExternalAgent(
        ctx,
        "chief",
        registration.channel.token,
        completed,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await receiveExternalAgent(
        ctx,
        "chief",
        registration.channel.token,
        completed,
      )
    ).status,
  ).toBe(200);
  expect((await drain())?.steps.map((step) => step.state)).toEqual([
    "completed",
    "running",
    "pending",
  ]);
  const childDelivery = deliveries.find(
    (item) => item.payload.agentId === "brand",
  );
  expect(childDelivery).toBeDefined();
  if (!childDelivery)
    throw new Error("Expected Marketer delivery to Chief's deployment");
  const childBase = {
    continuation: childDelivery.payload.continuation,
    sessionId: "lead-session",
  };
  expect(
    (
      await receiveExternalAgent(ctx, "brand", registration.channel.token, {
        ...base,
        deliveryId: "wrong-parent-capability",
        body: "Not authorized",
        complete: true,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await receiveExternalAgent(ctx, "chief", registration.channel.token, {
        ...childBase,
        deliveryId: "wrong-child-identity",
        body: "Not authorized",
        complete: true,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await receiveExternalAgent(ctx, "brand", registration.channel.token, {
        ...childBase,
        deliveryId: "marketer-final",
        body: "Here is the finished campaign.",
        complete: true,
      })
    ).status,
  ).toBe(200);
  expect((await drain())?.steps.map((step) => step.state)).toEqual([
    "completed",
    "completed",
    "running",
  ]);
  const messages = await testConversationMessages(
    ctx,
    ctx.principal,
    "mission-control",
  );
  const marketerReply = messages.find(
    (message) => message.body === "Here is the finished campaign.",
  );
  expect(marketerReply?.author).toMatchObject({ kind: "agent", id: "brand" });
  expect(marketerReply?.threadRootId).toBe(initial?.threadRootId);
  const announcements = messages.filter((message) =>
    message.components.some((component) => component.kind === "schedule.run"),
  );
  expect(announcements).toHaveLength(1);
  expect(announcements[0]?.author).toEqual({ kind: "system", id: "relay" });
  expect(
    messages.filter((message) => message.body.includes("Chief, draft")),
  ).toHaveLength(1);
  expect(
    messages.some((message) => message.body.includes("Expected result:")),
  ).toBe(false);
  await runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
    await state.storage.deleteAlarm();
  });
});
