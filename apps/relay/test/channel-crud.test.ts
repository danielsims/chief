import { describe, expect, it } from "vitest";

import { agentIdSchema } from "@chief/relay-contracts";

import {
  activeTestSnapshot as activeSnapshot,
  agentId,
  testAgentPrincipal as agentPrincipal,
  testConversationMessages as conversationMessages,
  channelEnvelope as envelope,
  outsiderId,
  ownerId,
  registerTestAgent as registerAgent,
  channelRpc as rpc,
  setupChannelTest as setup,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

describe("workspace channels", () => {
  it("starts an idempotent member-only DM without leaking it into channels", async () => {
    const ctx = await setup();
    const owner = ctx.principal;
    await registerAgent(ctx, agentId, hexKey(String(agentId)));

    const command = envelope({
      participant: { kind: "agent", principalId: agentId },
    });
    const first = await rpc(ctx, owner, "directs-start", command);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      conversation: { id: string; name: string; kind: string };
    };
    expect(firstBody.conversation).toMatchObject({
      name: agentId,
      kind: "direct",
    });

    const second = await rpc(
      ctx,
      owner,
      "directs-start",
      envelope({
        participant: { kind: "agent", principalId: agentId },
      }),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      conversation: { id: firstBody.conversation.id, kind: "direct" },
    });
    const channels = await rpc(ctx, owner, "channels-list");
    const channelBody = (await channels.json()) as {
      channels: Array<{ id: string }>;
    };
    expect(channelBody.channels.map((channel) => channel.id)).not.toContain(
      firstBody.conversation.id,
    );
    const snapshot = await activeSnapshot(ctx);
    expect(snapshot.conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstBody.conversation.id,
          kind: "direct",
        }),
      ]),
    );
  });

  it("creates, lists, gets, updates, archives, and unarchives a channel", async () => {
    const ctx = await setup();
    const owner = ctx.principal;

    const create = await rpc(
      ctx,
      owner,
      "channels-create",
      envelope({
        conversationId: "team",
        name: "team",
        isPrivate: true,
      }),
    );
    expect(create.status).toBe(201);
    expect(await create.json()).toMatchObject({
      channel: { id: "team", name: "team", isPrivate: true, archived: false },
      members: [{ kind: "user", principalId: ownerId, role: "owner" }],
    });

    const replay = await rpc(
      ctx,
      owner,
      "channels-create",
      envelope({
        conversationId: "team",
        name: "team",
        isPrivate: true,
      }),
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      channel: { id: "team", name: "team", isPrivate: true },
    });

    const duplicate = await rpc(
      ctx,
      owner,
      "channels-create",
      envelope({
        conversationId: "team",
        name: "again",
      }),
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: { code: "channel_already_exists" },
    });

    const list = await rpc(ctx, owner, "channels-list");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      channels: expect.arrayContaining([
        expect.objectContaining({ id: "team" }),
      ]),
    });

    const get = await rpc(
      ctx,
      owner,
      "channels-get",
      undefined,
      "conversationId=team",
    );
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({
      channel: { id: "team" },
      members: [{ kind: "user", principalId: ownerId, role: "owner" }],
    });

    const update = await rpc(
      ctx,
      owner,
      "channels-update",
      envelope({
        conversationId: "team",
        name: "Team A",
      }),
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ id: "team", name: "Team A" });

    const archive = await rpc(
      ctx,
      owner,
      "channels-archive",
      envelope({
        conversationId: "team",
      }),
    );
    expect(archive.status).toBe(200);
    expect(await archive.json()).toMatchObject({
      id: "team",
      archived: true,
    });

    const unarchive = await rpc(
      ctx,
      owner,
      "channels-unarchive",
      envelope({
        conversationId: "team",
      }),
    );
    expect(unarchive.status).toBe(200);
    const unarchived = (await unarchive.json()) as { id: string };
    expect(unarchived).toMatchObject({ id: "team", archived: false });
  });

  it("lets an agent join and leave, but an owner cannot leave their own channel", async () => {
    const ctx = await setup();
    const owner = ctx.principal;
    await rpc(
      ctx,
      owner,
      "channels-create",
      envelope({
        conversationId: "team",
        name: "team",
      }),
    );

    const leaveOwner = await rpc(
      ctx,
      owner,
      "channels-leave",
      envelope({
        conversationId: "team",
      }),
    );
    expect(leaveOwner.status).toBe(403);
    expect(await leaveOwner.json()).toMatchObject({
      error: { code: "channel_owner_leave_denied" },
    });

    await registerAgent(ctx, agentId, hexKey(String(agentId)));
    const agent = agentPrincipal(ctx, agentId, hexKey(String(agentId)));

    const join = await rpc(
      ctx,
      agent,
      "channels-join",
      envelope({
        conversationId: "team",
      }),
    );
    expect(join.status).toBe(200);
    expect(await join.json()).toEqual({ ok: true });

    const agentMemberships = await rpc(ctx, agent, "channels-memberships-self");
    expect(agentMemberships.status).toBe(200);
    expect(await agentMemberships.json()).toMatchObject({
      memberships: [
        { kind: "agent", principalId: agentId, conversationId: "team" },
      ],
    });

    const members = await rpc(
      ctx,
      owner,
      "channels-members-list",
      undefined,
      "conversationId=team",
    );
    expect(members.status).toBe(200);
    expect(await members.json()).toMatchObject({
      members: [
        { kind: "user", principalId: ownerId, role: "owner" },
        { kind: "agent", principalId: agentId, role: "member" },
      ],
    });

    const leave = await rpc(
      ctx,
      agent,
      "channels-leave",
      envelope({
        conversationId: "team",
      }),
    );
    expect(leave.status).toBe(200);
    expect(await leave.json()).toEqual({ ok: true });

    const membershipsAfterLeave = await rpc(
      ctx,
      agent,
      "channels-memberships-self",
    );
    expect(await membershipsAfterLeave.json()).toEqual({ memberships: [] });
  });

  it("adds and removes members with owner checks, and forbids non-members", async () => {
    const ctx = await setup();
    const owner = ctx.principal;
    await rpc(
      ctx,
      owner,
      "channels-create",
      envelope({
        conversationId: "team",
        name: "team",
      }),
    );
    await registerAgent(ctx, agentId, hexKey(String(agentId)));
    const agent1 = agentPrincipal(ctx, agentId, hexKey(String(agentId)));
    const agent2Id = agentIdSchema.parse("assistant");
    await registerAgent(ctx, agent2Id, hexKey(String(agent2Id)));

    const outsider = {
      kind: "user" as const,
      userId: outsiderId,
      pubkey: hexKey(String(outsiderId)),
      workspaceId: ctx.workspaceId,
      role: "member" as const,
    };
    const forbidden = await rpc(ctx, outsider, "channels-list");
    expect(forbidden.status).toBe(403);

    const add1 = await rpc(
      ctx,
      owner,
      "channels-members-add",
      envelope({
        conversationId: "team",
        kind: "agent",
        principalId: agentId,
      }),
    );
    expect(add1.status).toBe(200);
    const add2 = await rpc(
      ctx,
      owner,
      "channels-members-add",
      envelope({
        conversationId: "team",
        kind: "agent",
        principalId: agent2Id,
      }),
    );
    expect(add2.status).toBe(200);

    // A non-owner agent may not remove another member.
    const removePeer = await rpc(
      ctx,
      agent1,
      "channels-members-remove",
      envelope({
        conversationId: "team",
        kind: "agent",
        principalId: agent2Id,
      }),
    );
    expect(removePeer.status).toBe(403);
    expect(await removePeer.json()).toMatchObject({
      error: { code: "channel_member_remove_denied" },
    });
    // Nor may it remove the channel owner.
    const removeOwner = await rpc(
      ctx,
      agent1,
      "channels-members-remove",
      envelope({
        conversationId: "team",
        kind: "user",
        principalId: ownerId,
      }),
    );
    expect(removeOwner.status).toBe(403);
    expect(await removeOwner.json()).toMatchObject({
      error: { code: "channel_owner_remove_denied" },
    });

    const remove = await rpc(
      ctx,
      owner,
      "channels-members-remove",
      envelope({
        conversationId: "team",
        kind: "agent",
        principalId: agent2Id,
      }),
    );
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ ok: true });

    const members = await rpc(
      ctx,
      owner,
      "channels-members-list",
      undefined,
      "conversationId=team",
    );
    expect(await members.json()).toMatchObject({
      members: [
        { kind: "user", principalId: ownerId, role: "owner" },
        { kind: "agent", principalId: agentId, role: "member" },
      ],
    });
  });

  it("lets an agent create a channel, invite the owner, and reflect it in the snapshot", async () => {
    const ctx = await setup();
    await registerAgent(ctx, agentId, hexKey(String(agentId)));
    const agent = agentPrincipal(ctx, agentId, hexKey(String(agentId)));

    const create = await rpc(
      ctx,
      agent,
      "channels-create",
      envelope({
        conversationId: "briefing",
        name: "briefing",
        isPrivate: true,
      }),
    );
    expect(create.status).toBe(201);
    expect(await create.json()).toMatchObject({
      channel: { id: "briefing" },
      members: [{ kind: "agent", principalId: agentId, role: "owner" }],
    });

    const invite = await rpc(
      ctx,
      agent,
      "channels-members-add",
      envelope({
        conversationId: "briefing",
        kind: "user",
        principalId: ownerId,
      }),
    );
    expect(invite.status).toBe(200);
    const retryInvite = await rpc(
      ctx,
      agent,
      "channels-members-add",
      envelope({
        conversationId: "briefing",
        kind: "user",
        principalId: ownerId,
      }),
    );
    expect(retryInvite.status).toBe(200);

    const members = await rpc(
      ctx,
      agent,
      "channels-members-list",
      undefined,
      "conversationId=briefing",
    );
    expect(await members.json()).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({
          kind: "agent",
          principalId: agentId,
          role: "owner",
        }),
        expect.objectContaining({
          kind: "user",
          principalId: ownerId,
          role: "member",
        }),
      ]),
    });

    const messages = await conversationMessages(ctx, agent, "briefing");
    const membershipEvents = messages.filter((message) =>
      message.components.some(
        (component) =>
          component.kind === "channel-action" &&
          component.payload.type === "member-added",
      ),
    );
    expect(membershipEvents).toHaveLength(1);
    expect(membershipEvents[0]).toMatchObject({
      author: { kind: "system", id: "relay" },
      body: "Coordinator added you to the channel.",
      components: [
        expect.objectContaining({
          kind: "channel-action",
          payload: expect.objectContaining({
            actorId: agentId,
            actorName: "Coordinator",
            actorType: "agent",
            targetId: ownerId,
            targetKind: "user",
            targetName: "you",
            type: "member-added",
          }),
        }),
      ],
    });

    const active = await activeSnapshot(ctx);
    expect(active.conversations).toContainEqual({
      id: "briefing",
      name: "briefing",
      kind: "channel",
      isPrivate: true,
      archived: false,
      unreadCount: 0,
      requiresAttention: false,
      lastMessage: null,
    });
  });
});
