import { describe, expect, it } from "vitest";

import type { JsonObject } from "@chief/relay-contracts";
import {
  ensureChiefOrganization,
  ensureChiefOrganizationMember,
  hasChiefOrganizationMembership,
} from "@chief/auth/d1-organizations";
import {
  userIdSchema,
  workspaceMemberListSchema,
  workspaceMemberRemoveResultSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "../src/auth";
import {
  claimWorkspaceInvite,
  createWorkspaceInvite,
} from "../src/workspace-authority";
import { removeWorkspaceMember } from "../src/workspace-members-administration";
import { channelRpc, setupChannelTest } from "./channel-test-helpers";
import { hexKey } from "./helpers";

const inviteSecret = "N_s0L3cH7b3YJfOqoxjjqaMk7HI2KDh56ROHWh-0a8I";

async function setupRemovableMember() {
  const ctx = await setupChannelTest();
  const env = Object.assign(Object.create(ctx.env), {
    ACCOUNT_IDENTITY_MODE: "chief-account" as const,
  }) as Env;
  const memberId = userIdSchema.parse(`remove-member-${crypto.randomUUID()}`);
  await Promise.all([
    insertUser(env.AUTH_DB, ctx.identity.userId),
    insertUser(env.AUTH_DB, memberId),
  ]);
  await ensureChiefOrganization(env.AUTH_DB, {
    name: "Channel test",
    ownerUserId: ctx.identity.userId,
    website: "https://heychief.sh",
    workspaceId: ctx.workspaceId,
  });
  await ensureChiefOrganizationMember(env.AUTH_DB, {
    organizationId: ctx.workspaceId,
    userId: memberId,
  });

  const created = await createWorkspaceInvite(
    env,
    jsonRequest({
      commandId: crypto.randomUUID(),
      secret: inviteSecret,
      conversationId: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    }),
    {
      principal: ctx.principal,
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
    },
  );
  expect(created.status).toBe(201);

  const claimed = await claimWorkspaceInvite(
    env,
    jsonRequest({ commandId: crypto.randomUUID(), secret: inviteSecret }),
    {
      identity: { kind: "user", userId: memberId, pubkey: hexKey(memberId) },
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
    },
  );
  expect(claimed.status).toBe(200);
  return { ctx, env, memberId };
}

describe("workspace member removal", () => {
  it("lets an owner remove a member, revoking relay and organization access", async () => {
    const { ctx, env, memberId } = await setupRemovableMember();

    const before = await channelRpc(ctx, ctx.principal, "members-list");
    expect(
      workspaceMemberListSchema
        .parse(await before.json())
        .members.some((member) => member.principalId === memberId),
    ).toBe(true);
    expect(
      await hasChiefOrganizationMembership(env.AUTH_DB, {
        organizationId: ctx.workspaceId,
        userId: memberId,
      }),
    ).toBe(true);

    const response = await removeWorkspaceMember(env, {
      principal: ctx.principal,
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      kind: "user",
      principalId: memberId,
    });
    expect(response.status).toBe(200);
    expect(
      workspaceMemberRemoveResultSchema.parse(await response.json()),
    ).toEqual({ removed: true });

    const after = await channelRpc(ctx, ctx.principal, "members-list");
    expect(
      workspaceMemberListSchema
        .parse(await after.json())
        .members.some((member) => member.principalId === memberId),
    ).toBe(false);
    expect(
      await hasChiefOrganizationMembership(env.AUTH_DB, {
        organizationId: ctx.workspaceId,
        userId: memberId,
      }),
    ).toBe(false);
  });

  it("refuses a non-admin member", async () => {
    const { ctx, env, memberId } = await setupRemovableMember();

    await expect(
      removeWorkspaceMember(env, {
        principal: { ...ctx.principal, role: "member" },
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        kind: "user",
        principalId: memberId,
      }),
    ).rejects.toThrow(AuthorizationError);

    const after = await channelRpc(ctx, ctx.principal, "members-list");
    expect(
      workspaceMemberListSchema
        .parse(await after.json())
        .members.some((member) => member.principalId === memberId),
    ).toBe(true);
    expect(
      await hasChiefOrganizationMembership(env.AUTH_DB, {
        organizationId: ctx.workspaceId,
        userId: memberId,
      }),
    ).toBe(true);
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
      `INSERT OR IGNORE INTO user (
        id, name, email, email_verified, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, id, `${id}@example.test`, now, now)
    .run();
}
