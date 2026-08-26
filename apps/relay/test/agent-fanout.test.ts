import { describe, expect, it } from "vitest";

import { agentIdSchema, agentJobSchema } from "@chief/relay-contracts";

import { publishAgentMessage } from "../src/agent-message-publisher";
import { hostedTurnResult } from "../src/hosted-agent-runner";
import { channelIdForKey } from "../src/hosted-agent-tools/toolkits/channels";
import { withTrustedContext } from "../src/internal-context";
import { workspaceOnboardingInstruction } from "../src/workspace-onboarding-job";
import {
  registerTestAgent as registerAgent,
  setupChannelTest as setup,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

describe("agent fan-out integrity", () => {
  it("publishes kickoff results at the top level of the work channel", () => {
    const now = new Date().toISOString();
    const result = hostedTurnResult(
      agentJobSchema.parse({
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        agentId: agentIdSchema.parse("engineer"),
        kind: "workspace.kickoff.engineering",
        payload: {
          conversationId: "engineering",
          threadRootId: crypto.randomUUID(),
        },
        status: "leased",
        attempt: 1,
        availableAt: now,
        leaseExpiresAt: now,
        createdAt: now,
        updatedAt: now,
      }),
      "Engineering is ready.",
    );

    expect(result).toEqual({
      publishedMessage: {
        conversationId: "engineering",
        body: "Engineering is ready.",
        components: [],
      },
    });
  });

  it("derives a stable channel id from an operationKey", async () => {
    const first = await channelIdForKey("marketing-channel");
    const second = await channelIdForKey("marketing-channel");
    expect(first).toBe(second);
    expect(first).toMatch(/^channel-[0-9a-f]{24}$/u);
  });

  it("derives distinct channel ids for distinct operation keys", async () => {
    const marketing = await channelIdForKey("marketing-channel");
    const engineering = await channelIdForKey("engineering-channel");
    expect(marketing).not.toBe(engineering);
  });

  it("keeps the @tag because it is the genuine wake for the kickoff", () => {
    const instruction = workspaceOnboardingInstruction({
      name: "Acme",
      website: "https://acme.test",
      selectedApps: ["notion.com"],
    });
    // Each specialist is genuinely recalled by name so the mention-wake path
    // drives the kickoff. The @Name is what the relay and mobile validation
    // match on; the machine mention list is what wakes the cell.
    expect(instruction).toMatch(/mentions \["brand"\]/u);
    expect(instruction).toMatch(/mentions \["prospector"\]/u);
    expect(instruction).toMatch(/mentions \["engineer"\]/u);
    expect(instruction).toMatch(/mentions \["setup"\]/u);
    expect(instruction).toMatch(/@Marketer/u);
    expect(instruction).toMatch(/@Prospector/u);
    expect(instruction).toMatch(/@Engineer/u);
    expect(instruction).toMatch(/@Setup/u);
  });

  it("does not double-dispatch a competing job while Chief is running onboarding", async () => {
    const ctx = await setup();
    const chiefId = agentIdSchema.parse("chief");
    const chiefPubkey = hexKey("chief-onboarding");
    await registerAgent(ctx, chiefId, chiefPubkey);
    await registerAgent(
      ctx,
      agentIdSchema.parse("brand"),
      hexKey("brand-onboarding"),
    );
    const now = new Date().toISOString();
    await publishAgentMessage(
      ctx.env,
      agentJobSchema.parse({
        id: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        agentId: chiefId,
        agentPubkey: chiefPubkey,
        kind: "workspace.onboarding",
        payload: { name: "Acme" },
        status: "leased",
        attempt: 1,
        availableAt: now,
        leaseExpiresAt: now,
        createdAt: now,
        updatedAt: now,
      }),
      {
        conversationId: "mission-control",
        body: "Hey @Marketer, use [chief-skill:build-brand-profile].",
        mentions: [agentIdSchema.parse("brand")],
      },
      crypto.randomUUID(),
    );

    // The specialist cell must NOT also be woken by a competing
    // conversation.message job in mission-control. enqueueKickoff owns the
    // single workspace.kickoff.* wake for onboarding.
    const brand = ctx.env.AGENTS.get(
      ctx.env.AGENTS.idFromName(`${ctx.workspaceId}:brand`),
    );
    const claim = await brand.fetch(
      withTrustedContext(
        new Request("https://agent.internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workerId: "fanout-guard", leaseSeconds: 60 }),
        }),
        {
          principal: {
            kind: "agent",
            agentId: agentIdSchema.parse("brand"),
            pubkey: hexKey("brand-onboarding"),
            workspaceId: ctx.workspaceId,
            role: "member",
          },
          requestId: crypto.randomUUID(),
          workspaceId: ctx.workspaceId,
        },
      ),
    );
    expect(claim.status).toBe(204);
  });
});
