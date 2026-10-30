import { directStartResultSchema } from "@chief/relay-contracts";

import {
  agentId,
  channelEnvelope,
  channelRpc,
  registerTestAgent,
  setupChannelTest,
  testAgentPrincipal,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

export async function setupScheduleTest(extraPermissions: string[] = []) {
  const ctx = await setupChannelTest();
  const pubkey = hexKey("scheduled-worker");
  await registerTestAgent(ctx, agentId, pubkey);
  await channelRpc(ctx, ctx.principal, "agent-config-set", {
    agentId,
    config: {
      enabled: true,
      deploymentTarget: "phone",
      inference: { provider: "opencode", model: "test" },
      approvals: "auto",
      capabilities: [],
      integrations: [],
      toolPermissions: [
        ...extraPermissions,
        "workspace.read",
        "workspace.write",
        "messages.read",
        "messages.send",
      ],
    },
  });
  const direct = await channelRpc(
    ctx,
    ctx.principal,
    "directs-start",
    channelEnvelope({ participant: { kind: "agent", principalId: agentId } }),
  );
  const conversationId = directStartResultSchema.parse(await direct.json())
    .conversation.id;
  const principal = testAgentPrincipal(ctx, agentId, pubkey);
  const input = {
    id: "weekly-marketing",
    agentId,
    conversationId,
    title: "Review the marketing experiment",
    instructions:
      "Compare this week's signups with the baseline and suggest the next experiment.",
    cron: "0 9 * * 1",
    timezone: "Australia/Brisbane",
    approvalSummary: "A weekly review in this channel.",
    proposedToolPatterns: [],
  };
  return { ctx, principal, input };
}
