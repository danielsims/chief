import { describe, expect, it } from "vitest";

import {
  agentIdSchema,
  agentJobSchema,
  appendMessageCommandSchema,
} from "@chief/relay-contracts";

import { publishAgentMessage } from "../src/agent-message-publisher";
import { dispatchAppendedMessage } from "../src/conversation-agent-dispatch";
import { withTrustedContext } from "../src/internal-context";
import {
  agentId,
  testAgentPrincipal as agentPrincipal,
  dispatchTestMessage as dispatchMessage,
  channelEnvelope as envelope,
  ownerId,
  registerTestAgent as registerAgent,
  channelRpc as rpc,
  setupChannelTest as setup,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

describe("workspace agent message dispatch", () => {
  it("queues one idempotent job for the agent member of a direct message", async () => {
    const ctx = await setup();
    await registerAgent(ctx, agentId, hexKey(String(agentId)));
    await assignAgentProvider(ctx);
    const direct = await rpc(
      ctx,
      ctx.principal,
      "directs-start",
      envelope({ participant: { kind: "agent", principalId: agentId } }),
    );
    const conversationId = (
      (await direct.json()) as { conversation: { id: string } }
    ).conversation.id;
    const message = testMessage(ctx, conversationId, "Can you review this?");

    const dispatched = await dispatchMessage(ctx, ctx.principal, message);
    const duplicate = await dispatchMessage(ctx, ctx.principal, message);
    expect(await dispatched.json()).toEqual({ agentIds: [agentId] });
    expect(duplicate.status).toBe(200);

    const agent = ctx.env.AGENTS.get(
      ctx.env.AGENTS.idFromName(`${ctx.workspaceId}:${agentId}`),
    );
    const claim = await agent.fetch(
      withTrustedContext(
        new Request("https://agent.internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workerId: "dm-test", leaseSeconds: 60 }),
        }),
        {
          principal: agentPrincipal(ctx, agentId, hexKey(String(agentId))),
          requestId: crypto.randomUUID(),
          workspaceId: ctx.workspaceId,
        },
      ),
    );
    expect(await claim.json()).toMatchObject({
      job: {
        agentId,
        kind: "conversation.message",
        payload: {
          conversationId,
          messageId: message.id,
          workflowId: message.id,
          instruction: message.body,
        },
      },
    });
  });

  it("invites and dispatches an agent mentioned outside a private channel", async () => {
    const ctx = await setup();
    await registerAgent(ctx, agentId, hexKey(String(agentId)));
    await assignAgentProvider(ctx);
    await rpc(
      ctx,
      ctx.principal,
      "channels-create",
      envelope({
        conversationId: "private-team",
        name: "private-team",
        isPrivate: true,
      }),
    );
    const response = await dispatchMessage(ctx, ctx.principal, {
      ...testMessage(ctx, "private-team", "@Coordinator please review this."),
      mentions: [agentId],
    });

    expect(await response.json()).toEqual({ agentIds: [agentId] });
    const members = await rpc(
      ctx,
      ctx.principal,
      "channels-members-list",
      undefined,
      "conversationId=private-team",
    );
    expect(await members.json()).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({ kind: "agent", principalId: agentId }),
      ]),
    });
    expect(await claimAgent(ctx, agentId)).toMatchObject({
      job: { agentId, payload: { conversationId: "private-team" } },
    });
  });

  it("queues an agent mentioned by another agent", async () => {
    const ctx = await setup();
    const chiefId = agentIdSchema.parse("chief");
    const chiefPubkey = hexKey("chief-dispatch");
    await registerAgent(ctx, chiefId, chiefPubkey);
    await registerAgent(ctx, agentId, hexKey(String(agentId)));
    await assignAgentProvider(ctx);
    const now = new Date().toISOString();
    const workflowId = crypto.randomUUID();
    await publishAgentMessage(
      ctx.env,
      agentJobSchema.parse({
        id: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        agentId: chiefId,
        agentPubkey: chiefPubkey,
        kind: "conversation.message",
        payload: { workflowId },
        status: "leased",
        attempt: 1,
        availableAt: now,
        leaseExpiresAt: now,
        createdAt: now,
        updatedAt: now,
      }),
      {
        conversationId: "mission-control",
        body: "Hey @Coordinator, take this.",
        mentions: [agentId],
      },
      crypto.randomUUID(),
    );

    const agent = ctx.env.AGENTS.get(
      ctx.env.AGENTS.idFromName(`${ctx.workspaceId}:${agentId}`),
    );
    const claim = await agent.fetch(
      withTrustedContext(
        new Request("https://agent.internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workerId: "agent-mention-test",
            leaseSeconds: 60,
          }),
        }),
        {
          principal: agentPrincipal(ctx, agentId, hexKey(String(agentId))),
          requestId: crypto.randomUUID(),
          workspaceId: ctx.workspaceId,
        },
      ),
    );
    expect(await claim.json()).toMatchObject({
      job: {
        agentId,
        kind: "conversation.message",
        payload: {
          conversationId: "mission-control",
          workflowId,
          mentions: [agentId],
          instruction: "Hey @Coordinator, take this.",
        },
      },
    });
  });

  it("recognizes a visible agent mention and makes it the owning thread", async () => {
    const ctx = await setup();
    const setupId = agentIdSchema.parse("setup");
    await registerAgent(ctx, setupId, hexKey(String(setupId)));
    await assignProvider(ctx, setupId);
    const message = testMessage(
      ctx,
      "mission-control",
      "@Setup can you help with this privately?",
    );

    const response = await dispatchMessage(ctx, ctx.principal, message);
    expect(await response.json()).toEqual({ agentIds: [setupId] });
    expect(await claimAgent(ctx, setupId)).toMatchObject({
      job: {
        agentId: setupId,
        payload: {
          threadRootId: message.id,
          mentions: [setupId],
        },
      },
    });
  });

  it("routes an unmentioned thread reply back to the agent named by its root", async () => {
    const ctx = await setup();
    const setupId = agentIdSchema.parse("setup");
    await registerAgent(ctx, setupId, hexKey(String(setupId)));
    await assignProvider(ctx, setupId);
    const rootId = crypto.randomUUID();
    await appendConversationMessage(ctx, {
      id: rootId,
      body: "@Setup please handle this.",
      mentions: [setupId],
    });
    const reply = await appendConversationMessage(ctx, {
      id: crypto.randomUUID(),
      body: "Any progress?",
      mentions: [],
      threadRootId: rootId,
    });

    await dispatchAppendedMessage(ctx.env, {
      request: reply.request,
      response: reply.response,
      principal: ctx.principal,
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      conversationId: "mission-control",
    });

    expect(await claimAgent(ctx, setupId)).toMatchObject({
      job: {
        agentId: setupId,
        payload: {
          threadRootId: rootId,
          instruction: "Any progress?",
        },
      },
    });
  });
});

async function assignAgentProvider(ctx: Awaited<ReturnType<typeof setup>>) {
  return assignProvider(ctx, agentId);
}

async function assignProvider(
  ctx: Awaited<ReturnType<typeof setup>>,
  configuredAgentId: ReturnType<typeof agentIdSchema.parse>,
) {
  const response = await rpc(ctx, ctx.principal, "agent-config-set", {
    agentId: configuredAgentId,
    config: {
      enabled: true,
      deploymentTarget: "phone",
      inference: {
        provider: "opencode",
        model: "opencode-go/deepseek-v4-flash",
      },
      approvals: "auto",
      capabilities: [],
      integrations: [],
      toolPermissions: [
        "workspace.read",
        "channels.read",
        "channels.create",
        "members.read",
        "members.manage",
        "messages.read",
        "messages.send",
      ],
    },
  });
  expect(response.status).toBe(200);
}

async function claimAgent(
  ctx: Awaited<ReturnType<typeof setup>>,
  claimedAgentId: ReturnType<typeof agentIdSchema.parse>,
) {
  const agent = ctx.env.AGENTS.get(
    ctx.env.AGENTS.idFromName(`${ctx.workspaceId}:${claimedAgentId}`),
  );
  const response = await agent.fetch(
    withTrustedContext(
      new Request("https://agent.internal/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workerId: "thread-test", leaseSeconds: 60 }),
      }),
      {
        principal: {
          kind: "agent",
          agentId: claimedAgentId,
          pubkey: hexKey(String(claimedAgentId)),
          workspaceId: ctx.workspaceId,
          role: "member",
        },
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      },
    ),
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function appendConversationMessage(
  ctx: Awaited<ReturnType<typeof setup>>,
  input: {
    id: string;
    body: string;
    mentions: ReturnType<typeof agentIdSchema.parse>[];
    threadRootId?: string;
  },
) {
  const request = withTrustedContext(
    new Request(
      `https://conversation.internal/v1/workspaces/${ctx.workspaceId}/conversations/mission-control/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          appendMessageCommandSchema.parse({
            commandId: input.id,
            protocolVersion: 1,
            occurredAt: new Date().toISOString(),
            payload: {
              messageId: input.id,
              conversationId: "mission-control",
              body: input.body,
              mentions: input.mentions,
              components: [],
              ...(input.threadRootId
                ? { threadRootId: input.threadRootId }
                : undefined),
            },
          }),
        ),
      },
    ),
    {
      principal: ctx.principal,
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      conversationId: "mission-control",
    },
  );
  const response = await ctx.env.CONVERSATIONS.get(
    ctx.env.CONVERSATIONS.idFromName(`${ctx.workspaceId}:mission-control`),
  ).fetch(request);
  expect(response.status).toBe(200);
  return {
    request: new Request(request.url, { method: request.method }),
    response,
  };
}

function testMessage(
  ctx: Awaited<ReturnType<typeof setup>>,
  conversationId: string,
  body: string,
) {
  return {
    id: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
    conversationId,
    author: { kind: "user" as const, id: ownerId },
    body,
    mentions: [],
    components: [],
    reactions: [],
    edited: false,
    deleted: false,
    createdAt: new Date().toISOString(),
    sequence: 1,
  };
}
