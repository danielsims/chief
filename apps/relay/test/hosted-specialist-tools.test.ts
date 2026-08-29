import { describe, expect, it } from "vitest";

import { agentJobSchema } from "@chief/relay-contracts";

import { hostedAgentTools } from "../src/hosted-agent-tools/registry";
import { hostedAgentToolName } from "../src/hosted-agent-tools/tool";
import { specialistDelegationCommand } from "../src/hosted-agent-tools/toolkits/specialists";

describe("hosted specialist tools", () => {
  it("exposes durable specialist delegation to hosted Chief", () => {
    const tool = hostedAgentTools.find(
      (candidate) => hostedAgentToolName(candidate) === "specialists_delegate",
    );

    expect(tool?.effect).toBe("idempotent");
  });

  it("derives one stable specialist job from a replayed delegation", async () => {
    const now = new Date().toISOString();
    const job = agentJobSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      workspaceId: "workspace-a",
      agentId: "chief",
      kind: "conversation.message",
      payload: { conversationId: "mission-control" },
      status: "leased",
      attempt: 1,
      lastError: null,
      availableAt: now,
      leaseExpiresAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const input = {
      conversationId: "mission-control",
      delegationId: "brand-research",
      agentId: "brand",
      title: "Build the brand profile",
      task: "Research the website and save an evidence-backed profile.",
    };

    const first = await specialistDelegationCommand(job, input, now);
    const second = await specialistDelegationCommand(job, input, now);

    expect(first).toEqual(second);
    expect(first.command.commandId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first.jobId).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
