import { describe, expect, it } from "vitest";

import type { JsonObject } from "@chief/relay-contracts";
import {
  ensureChiefOrganization,
  ensureChiefOrganizationMember,
} from "@chief/auth/d1-organizations";
import {
  organizationWorkspaceJoinResultSchema,
  userIdSchema,
  workspaceInviteClaimResultSchema,
  workspaceInviteSchema,
  workspaceListResultSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "../src/auth";
import {
  claimWorkspaceInvite,
  createWorkspaceInvite,
  joinOrganizationWorkspace,
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

  it("provisions only an authenticated Better Auth organization member", async () => {
    const ctx = await setupChannelTest();
    const env = Object.assign(Object.create(ctx.env), {
      ACCOUNT_IDENTITY_MODE: "chief-account" as const,
    }) as Env;
    const invitedId = userIdSchema.parse(
      `organization-invitee-${crypto.randomUUID()}`,
    );
    const outsiderId = userIdSchema.parse(
      `organization-outsider-${crypto.randomUUID()}`,
    );
    await Promise.all([
      insertUser(env.AUTH_DB, ctx.identity.userId),
      insertUser(env.AUTH_DB, invitedId),
      insertUser(env.AUTH_DB, outsiderId),
    ]);
    await ensureChiefOrganization(env.AUTH_DB, {
      name: "Channel test",
      ownerUserId: ctx.identity.userId,
      website: "https://heychief.sh",
      workspaceId: ctx.workspaceId,
    });
    await ensureChiefOrganizationMember(env.AUTH_DB, {
      organizationId: ctx.workspaceId,
      userId: invitedId,
    });

    const result = await joinOrganizationWorkspace(env, {
      identity: {
        kind: "user",
        userId: invitedId,
        pubkey: hexKey(invitedId),
      },
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
    });
    expect(result.status).toBe(200);
    expect(
      organizationWorkspaceJoinResultSchema.parse(await result.json()),
    ).toMatchObject({
      workspaceId: ctx.workspaceId,
      workspaceName: "Channel test",
    });

    await expect(
      joinOrganizationWorkspace(env, {
        identity: {
          kind: "user",
          userId: outsiderId,
          pubkey: hexKey(outsiderId),
        },
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      }),
    ).rejects.toThrow(AuthorizationError);
  });
});

function jsonRequest(body: JsonObject) {
  return new Request("https://relay.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function insertUser(database: D1Database, id: string) {
  const now = Date.now();
  return database
    .prepare(
      `INSERT INTO user (
        id, name, email, email_verified, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, id, `${id}@example.test`, now, now)
    .run();
}
