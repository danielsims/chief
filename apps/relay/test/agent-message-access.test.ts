import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

import { defaultAgentConfig, userIdSchema } from "@chief/relay-contracts";

import type { WorkspaceObject } from "../src/workspace-object";
import {
  agentId,
  channelEnvelope as envelope,
  registerTestAgent,
  channelRpc as rpc,
  setupChannelTest,
  testAgentPrincipal,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

it("gates personal-agent DMs and existing DM writes when sharing is revoked", async () => {
  const ctx = await setupChannelTest();
  await registerTestAgent(ctx, agentId, hexKey(agentId));
  const other = {
    ...ctx.principal,
    userId: userIdSchema.parse("coworker"),
    pubkey: hexKey("coworker"),
    role: "member" as const,
  };
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  await runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
    state.storage.sql.exec(
      "INSERT INTO members (principal_kind, principal_id, role, created_at) VALUES ('user', ?, 'member', ?)",
      other.userId,
      new Date().toISOString(),
    );
  });
  const config = { ...defaultAgentConfig, deploymentTarget: "desktop" };
  const save = async (messageAccess: "owner" | "workspace") => {
    expect(
      (
        await rpc(ctx, ctx.principal, "agent-config-set", {
          agentId,
          config: { ...config, messageAccess },
        })
      ).status,
    ).toBe(200);
  };
  const start = (principal: typeof ctx.principal | typeof other) =>
    rpc(
      ctx,
      principal,
      "directs-start",
      envelope({ participant: { kind: "agent", principalId: agentId } }),
    );
  await save("owner");
  expect((await start(other)).status).toBe(403);
  expect((await start(ctx.principal)).status).toBe(201);
  await save("workspace");
  await runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
    state.storage.sql.exec(
      "UPDATE members SET role = 'admin' WHERE principal_kind = 'user' AND principal_id = ?",
      other.userId,
    );
  });
  const admin = { ...other, role: "admin" as const };
  expect(
    (
      await rpc(ctx, admin, "agent-config-set", {
        agentId,
        config: { ...config, messageAccess: "owner" },
      })
    ).status,
  ).toBe(403);
  expect(
    (await rpc(ctx, admin, "agent-remove", undefined, `agentId=${agentId}`))
      .status,
  ).toBe(403);

  const shared = await start(other);
  expect(shared.status).toBe(201);
  const { conversation } = (await shared.json()) as {
    conversation: { id: string };
  };
  expect(
    (
      await rpc(
        ctx,
        other,
        "authorize-conversation",
        undefined,
        `conversationId=${conversation.id}`,
        "messages.send",
      )
    ).status,
  ).toBe(200);
  await save("owner");
  expect(
    (
      await rpc(
        ctx,
        other,
        "authorize-conversation",
        undefined,
        `conversationId=${conversation.id}`,
        "messages.send",
      )
    ).status,
  ).toBe(403);
});

it("lets a device agent join public channels without granting membership administration", async () => {
  const ctx = await setupChannelTest();
  await registerTestAgent(ctx, agentId, hexKey(agentId));
  const agent = testAgentPrincipal(ctx, agentId, hexKey(agentId));
  expect(
    (
      await rpc(ctx, ctx.principal, "agent-config-set", {
        agentId,
        config: {
          ...defaultAgentConfig,
          deploymentTarget: "desktop",
          toolPermissions: ["channels.read", "messages.read", "messages.send"],
        },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await rpc(
        ctx,
        ctx.principal,
        "channels-create",
        envelope({ conversationId: "join-probe", name: "join-probe" }),
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await rpc(
        ctx,
        agent,
        "channels-join",
        envelope({ conversationId: "join-probe" }),
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
        "conversationId=join-probe",
        "messages.send",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await rpc(
        ctx,
        agent,
        "channels-members-add",
        envelope({
          conversationId: "join-probe",
          kind: "user",
          principalId: ctx.principal.userId,
        }),
      )
    ).status,
  ).toBe(403);
});
