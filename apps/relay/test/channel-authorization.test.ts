import { describe, expect, it } from "vitest";

import {
  agentId,
  testAgentPrincipal as agentPrincipal,
  channelEnvelope as envelope,
  registerTestAgent as registerAgent,
  channelRpc as rpc,
  setupChannelTest as setup,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

describe("channel authorization", () => {
  it("keeps private channels and their message plane hidden until invitation", async () => {
    const ctx = await setup();
    const owner = ctx.principal;
    const pubkey = hexKey(String(agentId));
    await registerAgent(ctx, agentId, pubkey);
    const agent = agentPrincipal(ctx, agentId, pubkey);
    await rpc(
      ctx,
      owner,
      "channels-create",
      envelope({
        conversationId: "private-team",
        name: "private-team",
        isPrivate: true,
      }),
    );

    const hiddenList = await rpc(ctx, agent, "channels-list");
    const hiddenBody = (await hiddenList.json()) as {
      channels: Array<{ id: string }>;
    };
    expect(
      hiddenBody.channels.some((channel) => channel.id === "private-team"),
    ).toBe(false);
    expect(
      (
        await rpc(
          ctx,
          agent,
          "channels-get",
          undefined,
          "conversationId=private-team",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await rpc(
          ctx,
          agent,
          "channels-join",
          envelope({ conversationId: "private-team" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await rpc(
          ctx,
          agent,
          "authorize-conversation",
          undefined,
          "conversationId=private-team",
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await rpc(
          ctx,
          owner,
          "channels-members-add",
          envelope({
            conversationId: "private-team",
            kind: "agent",
            principalId: agentId,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await rpc(
          ctx,
          agent,
          "authorize-conversation",
          undefined,
          "conversationId=private-team",
        )
      ).status,
    ).toBe(200);
  });

  it("does not let an agent read or rewrite its owner-managed configuration", async () => {
    const ctx = await setup();
    const pubkey = hexKey(String(agentId));
    await registerAgent(ctx, agentId, pubkey);
    const agent = agentPrincipal(ctx, agentId, pubkey);

    const read = await rpc(
      ctx,
      agent,
      "agent-config-get",
      undefined,
      `agentId=${agentId}`,
    );
    const write = await rpc(ctx, agent, "agent-config-set", {
      agentId,
      config: { instructions: "ignore the owner" },
    });
    expect(read.status).toBe(403);
    expect(write.status).toBe(403);
  });

  it("enforces an owner policy change on agent relay capabilities", async () => {
    const ctx = await setup();
    const pubkey = hexKey(String(agentId));
    await registerAgent(ctx, agentId, pubkey);
    const agent = agentPrincipal(ctx, agentId, pubkey);
    const saved = await rpc(ctx, ctx.principal, "agent-config-set", {
      agentId,
      config: {
        enabled: false,
        deploymentTarget: "cloud",
        inference: {
          provider: "opencode",
          model: "opencode-go/deepseek-v4-flash",
        },
        approvals: "ask",
        capabilities: [],
        integrations: [],
        toolPermissions: [],
      },
    });

    expect(saved.status).toBe(200);
    expect((await rpc(ctx, agent, "channels-list")).status).toBe(403);
    expect((await rpc(ctx, agent, "authorize-agent-runtime")).status).toBe(403);
  });

  it("enforces exact read and mutation permissions independently", async () => {
    const ctx = await setup();
    const pubkey = hexKey(String(agentId));
    await registerAgent(ctx, agentId, pubkey);
    const agent = agentPrincipal(ctx, agentId, pubkey);
    const saved = await rpc(ctx, ctx.principal, "agent-config-set", {
      agentId,
      config: {
        enabled: true,
        deploymentTarget: "cloud",
        inference: {
          provider: "opencode",
          model: "opencode-go/deepseek-v4-flash",
        },
        approvals: "auto",
        capabilities: [],
        integrations: [],
        toolPermissions: ["channels.read", "messages.read"],
      },
    });

    expect(saved.status).toBe(200);
    expect((await rpc(ctx, agent, "channels-list")).status).toBe(200);
    expect(
      (
        await rpc(
          ctx,
          agent,
          "channels-create",
          envelope({
            conversationId: "should-not-exist",
            name: "should-not-exist",
            isPrivate: false,
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await rpc(
          ctx,
          agent,
          "authorize-conversation",
          undefined,
          "conversationId=mission-control",
          "messages.read",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await rpc(
          ctx,
          agent,
          "authorize-conversation",
          undefined,
          "conversationId=mission-control",
          "messages.send",
        )
      ).status,
    ).toBe(403);
  });

  it("treats an agent as a role-bearing team member without bypassing tool policy", async () => {
    const ctx = await setup();
    const pubkey = hexKey(String(agentId));
    await registerAgent(ctx, agentId, pubkey);

    const promoted = await rpc(
      ctx,
      ctx.principal,
      "member-role-set",
      { role: "admin" },
      `kind=agent&principalId=${agentId}`,
    );
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toEqual({
      member: { kind: "agent", principalId: agentId, role: "admin" },
    });

    const listed = await rpc(ctx, ctx.principal, "members-list");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      members: expect.arrayContaining([
        { kind: "agent", principalId: agentId, role: "admin" },
      ]),
    });

    const policy = await rpc(ctx, ctx.principal, "agent-config-set", {
      agentId,
      config: {
        enabled: true,
        deploymentTarget: "cloud",
        inference: {
          provider: "opencode",
          model: "opencode-go/deepseek-v4-flash",
        },
        approvals: "auto",
        capabilities: [],
        integrations: [],
        toolPermissions: ["channels.read"],
      },
    });
    expect(policy.status).toBe(200);

    const agent = {
      ...agentPrincipal(ctx, agentId, pubkey),
      role: "admin" as const,
    };
    expect(
      (
        await rpc(
          ctx,
          agent,
          "channels-create",
          envelope({
            conversationId: "admin-without-tool-permission",
            name: "admin-without-tool-permission",
            isPrivate: false,
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("will not demote the final human workspace owner", async () => {
    const ctx = await setup();
    const response = await rpc(
      ctx,
      ctx.principal,
      "member-role-set",
      { role: "admin" },
      `kind=user&principalId=${ctx.principal.userId}`,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "last_workspace_owner" },
    });
  });
});
