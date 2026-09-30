import { describe, expect, it } from "vitest";

import { EXTERNAL_CHANNEL_AUTHORIZATION_HEADER } from "../src/external-agent-channel-security";
import { setupChannelTest } from "./channel-test-helpers";
import {
  registerExternalAgent,
  verifyExternalAgent,
  workspaceFetch,
} from "./external-agent-channel-helpers";

function memory(
  ctx: Awaited<ReturnType<typeof setupChannelTest>>,
  agentId: string,
  token: string,
  body: { action: string; scopeKey: string; text?: string; id?: number },
) {
  return workspaceFetch(
    ctx,
    "external-agent-memory",
    body,
    {
      kind: "service",
      service: "external-agent-channel",
      workspaceId: ctx.workspaceId,
    },
    `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/${agentId}/channel/memory`,
    { [EXTERNAL_CHANNEL_AUTHORIZATION_HEADER]: `Bearer ${token}` },
  );
}

describe("external agent memory", () => {
  it("keeps each agent's notes to that agent and its channel credential", async () => {
    const ctx = await setupChannelTest();
    const chief = await registerExternalAgent(ctx, { agentId: "eve-chief" });
    const writer = await registerExternalAgent(ctx, { agentId: "eve-writer" });
    await verifyExternalAgent(ctx, "eve-chief");
    await verifyExternalAgent(ctx, "eve-writer");
    const scopeKey = "scope-v1";

    const saved = await memory(ctx, "eve-chief", chief.channel.token, {
      action: "save",
      scopeKey,
      text: "Daniel ships from the release branch.",
    });
    expect(await saved.json()).toEqual({
      memories: [{ id: 1, text: "Daniel ships from the release branch." }],
    });

    const otherAgent = await memory(ctx, "eve-writer", writer.channel.token, {
      action: "recall",
      scopeKey,
    });
    expect(await otherAgent.json()).toEqual({ memories: [] });

    const forged = await memory(ctx, "eve-chief", writer.channel.token, {
      action: "recall",
      scopeKey,
    });
    expect(forged.status).toBe(401);

    const removed = await memory(ctx, "eve-chief", chief.channel.token, {
      action: "remove",
      scopeKey,
      id: 1,
    });
    expect(await removed.json()).toEqual({ memories: [] });
  });
});
