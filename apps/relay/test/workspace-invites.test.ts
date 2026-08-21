import { describe, expect, it } from "vitest";

import {
  userIdSchema,
  workspaceInviteClaimResultSchema,
  workspaceInviteSchema,
  workspaceListResultSchema,
} from "@chief/relay-contracts";

import {
  claimWorkspaceInvite,
  createWorkspaceInvite,
  listManagedWorkspaces,
  previewWorkspaceInvite,
} from "../src/workspace-authority";
import {
  channelEnvelope,
  channelRpc,
  setupChannelTest,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

describe("workspace invites", () => {
  it("previews and atomically admits one account to a private channel", async () => {
    const ctx = await setupChannelTest();
    await channelRpc(
      ctx,
      ctx.principal,
      "channels-create",
      channelEnvelope({
        conversationId: "invited-team",
        name: "Invited team",
        isPrivate: true,
      }),
    );
    const secret = "N_s0L3cH7b3YJfOqoxjjqaMk7HI2KDh56ROHWh-0a8I";
    const createCommand = {
      commandId: crypto.randomUUID(),
      secret,
      conversationId: "invited-team",
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    };
    const created = await createWorkspaceInvite(
      ctx.env,
      jsonRequest(createCommand),
      {
        principal: ctx.principal,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      },
    );
    expect(created.status).toBe(201);
    expect(workspaceInviteSchema.parse(await created.json())).toMatchObject({
      workspaceId: ctx.workspaceId,
      conversationId: "invited-team",
      conversationName: "Invited team",
    });

    const preview = await previewWorkspaceInvite(
      ctx.env,
      jsonRequest({ secret }),
      ctx.workspaceId,
    );
    expect(preview.status).toBe(200);
    expect(workspaceInviteSchema.parse(await preview.json())).toMatchObject({
      workspaceName: "Channel test",
      website: "https://heychief.sh",
    });

    const invitedIdentity = {
      kind: "user" as const,
      userId: userIdSchema.parse("workspace-invitee"),
      pubkey: hexKey("workspace-invitee"),
    };
    const claimCommand = { commandId: crypto.randomUUID(), secret };
    const claim = await claimWorkspaceInvite(
      ctx.env,
      jsonRequest(claimCommand),
      {
        identity: invitedIdentity,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      },
    );
    expect(claim.status).toBe(200);
    expect(
      workspaceInviteClaimResultSchema.parse(await claim.json()),
    ).toMatchObject({ alreadyMember: false });

    const directory = workspaceListResultSchema.parse(
      await (await listManagedWorkspaces(ctx.env, invitedIdentity)).json(),
    );
    expect(directory.workspaces).toEqual([
      expect.objectContaining({
        id: ctx.workspaceId,
        name: "Channel test",
        isActive: true,
      }),
    ]);
    const privateChannel = await channelRpc(
      ctx,
      {
        kind: "user",
        userId: invitedIdentity.userId,
        pubkey: invitedIdentity.pubkey,
        workspaceId: ctx.workspaceId,
        role: "member",
      },
      "channels-get",
      undefined,
      "conversationId=invited-team",
    );
    expect(privateChannel.status).toBe(200);

    const replay = await claimWorkspaceInvite(
      ctx.env,
      jsonRequest(claimCommand),
      {
        identity: invitedIdentity,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      },
    );
    expect(replay.status).toBe(200);
    expect(
      workspaceInviteClaimResultSchema.parse(await replay.json()),
    ).toMatchObject({ alreadyMember: true });

    const secondIdentity = {
      kind: "user" as const,
      userId: userIdSchema.parse("workspace-invitee-two"),
      pubkey: hexKey("workspace-invitee-two"),
    };
    const consumed = await claimWorkspaceInvite(
      ctx.env,
      jsonRequest({ commandId: crypto.randomUUID(), secret }),
      {
        identity: secondIdentity,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      },
    );
    expect(consumed.status).toBe(410);
    expect(await consumed.json()).toMatchObject({
      error: { code: "workspace_invite_consumed" },
    });
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://relay.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
