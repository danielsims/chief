import { describe, expect, it } from "vitest";

import { agentIdSchema, agentJobSchema } from "@chief/relay-contracts";

import { publishAgentMessage } from "../src/agent-message-publisher";
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
          instruction: message.body,
        },
      },
    });
  });

  it("does not dispatch a private-channel mention to an agent outside it", async () => {
    const ctx = await setup();
    await registerAgent(ctx, agentId, hexKey(String(agentId)));
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

    expect(await response.json()).toEqual({ agentIds: [] });
  });

  it("queues an agent mentioned by another agent", async () => {
    const ctx = await setup();
    const chiefId = agentIdSchema.parse("chief");
    const chiefPubkey = hexKey("chief-dispatch");
    await registerAgent(ctx, chiefId, chiefPubkey);
    await registerAgent(ctx, agentId, hexKey(String(agentId)));
    await assignAgentProvider(ctx);
    const now = new Date().toISOString();
    await publishAgentMessage(
      ctx.env,
      agentJobSchema.parse({
        id: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        agentId: chiefId,
        agentPubkey: chiefPubkey,
        kind: "workspace.onboarding",
        payload: {},
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
          mentions: [agentId],
          instruction: "Hey @Coordinator, take this.",
        },
      },
    });
  });
});

async function assignAgentProvider(ctx: Awaited<ReturnType<typeof setup>>) {
  const response = await rpc(ctx, ctx.principal, "agent-config-set", {
    agentId,
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
