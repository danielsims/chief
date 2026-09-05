import { afterEach, describe, expect, it, vi } from "vitest";

import {
  eveWorkspaceKickoffResultSchema,
  externalAgentRegistrationResultSchema,
  registerExternalAgentCommandSchema,
} from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";
import { WORKSPACE_ONBOARDING_OPENING_MESSAGE } from "../src/workspace-onboarding-job";
import {
  activeTestSnapshot,
  dispatchTestMessage,
  ownerId,
  setupChannelTest,
  testConversationMessages,
} from "./channel-test-helpers";

afterEach(() => vi.unstubAllGlobals());

describe("Eve workspace onboarding", () => {
  it("defers hosted kickoff until the workspace is entered", async () => {
    const ctx = await setupChannelTest({ agentRuntime: "vercel-eve" });
    await registerExternalAgent(ctx, {
      agentId: "chief",
      replaceNative: true,
    });
    const deliveredBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        deliveredBodies.push(await new Request(input, init).json());
        return Response.json({
          status: "accepted",
          sessionId: `eve-session-${deliveredBodies.length}`,
        });
      }),
    );

    await verifyExternalAgent(ctx, "chief");
    expect((await activeTestSnapshot(ctx)).onboardingComplete).toBe(false);
    expect(
      (await testConversationMessages(ctx, ctx.principal, "mission-control")).map(
        (message) => message.body,
      ),
    ).not.toContain(WORKSPACE_ONBOARDING_OPENING_MESSAGE);

    const started = await startEveOnboarding(ctx);
    expect(started).toEqual({ started: true });
    const messages = await testConversationMessages(
      ctx,
      ctx.principal,
      "mission-control",
    );
    expect(messages.map((message) => message.body)).toContain(
      WORKSPACE_ONBOARDING_OPENING_MESSAGE,
    );
    expect(messages.some((message) => message.body.includes("@Marketer"))).toBe(
      true,
    );
    expect(deliveredBodies).toEqual([]);
    expect((await activeTestSnapshot(ctx)).onboardingComplete).toBe(true);
    expect(await startEveOnboarding(ctx)).toEqual({ started: false });
  });

  it("wakes a connected Eve Chief from a DM even when hosted cells are disabled", async () => {
    const ctx = await setupChannelTest({ agentRuntime: "vercel-eve" });
    await registerExternalAgent(ctx, {
      agentId: "chief",
      replaceNative: true,
    });
    const deliveredBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        deliveredBodies.push(await new Request(input, init).json());
        return Response.json({
          status: "accepted",
          sessionId: `eve-dm-${deliveredBodies.length}`,
        });
      }),
    );
    await verifyExternalAgent(ctx, "chief");
    expect(deliveredBodies).toEqual([]);
    const dispatched = await dispatchTestMessage(ctx, ctx.principal, {
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      conversationId: "chief",
      author: { kind: "user" as const, id: ownerId },
      body: "Hey there",
      mentions: [],
      components: [],
      reactions: [],
      edited: false,
      deleted: false,
      createdAt: new Date().toISOString(),
      sequence: 1,
    });
    expect(dispatched.status).toBe(200);
    expect(await dispatched.json()).toEqual({ agentIds: ["chief"] });
    await vi.waitFor(() => expect(deliveredBodies.length).toBeGreaterThan(0));
    expect(deliveredBodies.at(-1)).toMatchObject({
      payload: {
        agentId: "chief",
        message: { body: "Hey there" },
      },
    });
  });
});

type TestContext = Awaited<ReturnType<typeof setupChannelTest>>;

async function registerExternalAgent(
  ctx: TestContext,
  input: { agentId: string; replaceNative?: boolean },
) {
  const command = registerExternalAgentCommandSchema.parse({
    commandId: crypto.randomUUID(),
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      agentId: input.agentId,
      name: "Chief",
      role: "External specialist",
      endpoint: "https://chief-agent.vercel.app/channels/chief/messages",
      replaceNative: input.replaceNative ?? false,
    },
  });
  const response = await ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request(
        `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/external`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": "external-agent-register",
          },
          body: JSON.stringify(command),
        },
      ),
      {
        principal: ctx.principal,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      },
    ),
  );
  expect([200, 201]).toContain(response.status);
  return externalAgentRegistrationResultSchema.parse(await response.json());
}

async function verifyExternalAgent(ctx: TestContext, agentId: string) {
  const response = await ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request(
        `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/${agentId}/external/verify`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": "external-agent-verify",
          },
          body: JSON.stringify({}),
        },
      ),
      {
        principal: ctx.principal,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      },
    ),
  );
  expect(response.status).toBe(200);
}

async function startEveOnboarding(ctx: TestContext) {
  const response = await ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request(
        `https://relay.test/v1/workspaces/${ctx.workspaceId}/onboarding/start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": "start-eve-onboarding",
          },
        },
      ),
      {
        principal: ctx.principal,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      },
    ),
  );
  expect(response.status).toBe(200);
  return eveWorkspaceKickoffResultSchema.parse(await response.json());
}
