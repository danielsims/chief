import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

import { defaultAgentConfig, userIdSchema } from "@chief/relay-contracts";

import type { WorkspaceObject } from "../src/workspace-object";
import { ensureSnapshotChannels } from "../src/workspace-channel-router";
import {
  activeTestSnapshot,
  agentId,
  channelEnvelope as envelope,
  ownerId,
  registerTestAgent,
  channelRpc as rpc,
  setupChannelTest,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

async function setupWithCoworker() {
  const ctx = await setupChannelTest();
  const coworker = {
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
      coworker.userId,
      new Date().toISOString(),
    );
  });
  return { ctx, coworker };
}

const channelIds = async (response: Response) =>
  (
    (await response.json()) as {
      channels: Array<{ id: string; directUserId?: string }>;
    }
  ).channels;

it("lists a person-to-person DM to both participants, each facing the other", async () => {
  const { ctx, coworker } = await setupWithCoworker();
  const started = await rpc(
    ctx,
    ctx.principal,
    "directs-start",
    envelope({ participant: { kind: "user", principalId: coworker.userId } }),
  );
  expect(started.status).toBe(201);
  const { conversation } = (await started.json()) as {
    conversation: { id: string };
  };

  const ownerChannels = await channelIds(
    await rpc(ctx, ctx.principal, "channels-list"),
  );
  expect(ownerChannels).toContainEqual(
    expect.objectContaining({
      id: conversation.id,
      directUserId: coworker.userId,
    }),
  );
  const coworkerChannels = await channelIds(
    await rpc(ctx, coworker, "channels-list"),
  );
  expect(coworkerChannels).toContainEqual(
    expect.objectContaining({ id: conversation.id, directUserId: ownerId }),
  );

  // Starting it again from the other side reuses the same conversation.
  const reused = await rpc(
    ctx,
    coworker,
    "directs-start",
    envelope({ participant: { kind: "user", principalId: ownerId } }),
  );
  expect(reused.status).toBe(200);
  expect(await reused.json()).toMatchObject({
    conversation: { id: conversation.id },
  });

  // Nobody can be added to a DM after the fact.
  const add = await rpc(
    ctx,
    ctx.principal,
    "channels-members-add",
    envelope({
      conversationId: conversation.id,
      kind: "agent",
      principalId: agentId,
      role: "member",
    }),
  );
  expect(add.status).toBe(400);
});

it("keeps each person's DMs out of everyone else's snapshot", async () => {
  const { ctx, coworker } = await setupWithCoworker();
  await registerTestAgent(ctx, agentId, hexKey(agentId));
  const shared = await rpc(ctx, ctx.principal, "agent-config-set", {
    agentId,
    config: {
      ...defaultAgentConfig,
      deploymentTarget: "desktop",
      messageAccess: "workspace",
    },
  });
  expect(shared.status).toBe(200);
  const coworkerDirect = await rpc(
    ctx,
    coworker,
    "directs-start",
    envelope({ participant: { kind: "agent", principalId: agentId } }),
  );
  const people = await rpc(
    ctx,
    ctx.principal,
    "directs-start",
    envelope({ participant: { kind: "user", principalId: coworker.userId } }),
  );
  const ids = (await activeTestSnapshot(ctx)).conversations.map(
    (conversation) => conversation.id,
  );
  expect(coworkerDirect.status).toBe(201);
  const leaked = (await coworkerDirect.json()) as {
    conversation: { id: string };
  };
  expect(ids).not.toContain(leaked.conversation.id);
  // The viewer's own person DM is listed, named after the peer.
  const own = (await people.json()) as { conversation: { id: string } };
  expect(ids).toContain(own.conversation.id);
});

it("never folds the workspace owner into someone else's DM", async () => {
  const { ctx, coworker } = await setupWithCoworker();
  await registerTestAgent(ctx, agentId, hexKey(agentId));
  expect(
    (
      await rpc(ctx, ctx.principal, "agent-config-set", {
        agentId,
        config: {
          ...defaultAgentConfig,
          deploymentTarget: "desktop",
          messageAccess: "workspace",
        },
      })
    ).status,
  ).toBe(200);
  const agentDirect = await rpc(
    ctx,
    coworker,
    "directs-start",
    envelope({ participant: { kind: "agent", principalId: agentId } }),
  );
  expect(agentDirect.status).toBe(201);
  const { conversation: coworkerAgentDm } = (await agentDirect.json()) as {
    conversation: { id: string };
  };

  // The backfill runs on every Durable Object cold start.
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  await runInDurableObject(stub, (_instance: WorkspaceObject, state) => {
    ensureSnapshotChannels(state.storage, ctx.env);
  });
  const members = await rpc(
    ctx,
    coworker,
    "channels-members-list",
    undefined,
    `conversationId=${coworkerAgentDm.id}`,
  );
  expect(members.status).toBe(200);
  const { members: rows } = (await members.json()) as {
    members: Array<{ principalId: string }>;
  };
  expect(rows.map((row) => row.principalId)).not.toContain(ownerId);

  // Messaging the coworker opens a new two-person DM, not their agent DM.
  const started = await rpc(
    ctx,
    ctx.principal,
    "directs-start",
    envelope({ participant: { kind: "user", principalId: coworker.userId } }),
  );
  expect(started.status).toBe(201);
  const { conversation } = (await started.json()) as {
    conversation: { id: string };
  };
  expect(conversation.id).not.toBe(coworkerAgentDm.id);
});
