import { describe, expect, it } from "vitest";

import type { JsonObject } from "@chief/relay-contracts";
import { ensureChiefOrganization } from "@chief/auth/d1-organizations";
import {
  workspaceInvitationListSchema,
  workspaceInvitationSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "../src/auth";
import {
  cancelWorkspaceInvitation,
  createWorkspaceInvitation,
  listWorkspaceInvitations,
} from "../src/workspace-members-administration";
import { setupChannelTest } from "./channel-test-helpers";

async function setupOwner() {
  const ctx = await setupChannelTest();
  ctx.env.EMAIL_PROVIDER = "none";
  await insertUser(ctx.env.AUTH_DB, ctx.identity.userId);
  await ensureChiefOrganization(ctx.env.AUTH_DB, {
    name: "Channel test",
    ownerUserId: ctx.identity.userId,
    website: "https://heychief.sh",
    workspaceId: ctx.workspaceId,
  });
  return ctx;
}

describe("workspace invitations", () => {
  it("invites, lists, resends the same pending row, and cancels", async () => {
    const ctx = await setupOwner();
    const scope = {
      principal: ctx.principal,
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
    };

    const created = await createWorkspaceInvitation(
      ctx.env,
      jsonRequest({ email: "Invitee@Example.test", role: "member" }),
      scope,
    );
    expect(created.status).toBe(201);
    const invitation = workspaceInvitationSchema.parse(await created.json());
    expect(invitation).toMatchObject({
      email: "invitee@example.test",
      role: "member",
      status: "pending",
    });

    const listed = await listWorkspaceInvitations(ctx.env, {
      principal: ctx.principal,
      workspaceId: ctx.workspaceId,
    });
    expect(listed.status).toBe(200);
    expect(
      workspaceInvitationListSchema.parse(await listed.json()).invitations,
    ).toHaveLength(1);

    // A resend extends the existing pending invitation rather than duplicating.
    const resent = await createWorkspaceInvitation(
      ctx.env,
      jsonRequest({
        email: "invitee@example.test",
        role: "admin",
        resend: true,
      }),
      scope,
    );
    const resentInvitation = workspaceInvitationSchema.parse(
      await resent.json(),
    );
    expect(resentInvitation.id).toBe(invitation.id);
    expect(resentInvitation.role).toBe("admin");

    const canceled = await cancelWorkspaceInvitation(ctx.env, {
      principal: ctx.principal,
      workspaceId: ctx.workspaceId,
      invitationId: invitation.id,
    });
    expect(canceled.status).toBe(200);

    const after = await listWorkspaceInvitations(ctx.env, {
      principal: ctx.principal,
      workspaceId: ctx.workspaceId,
    });
    expect(
      workspaceInvitationListSchema.parse(await after.json()).invitations[0]
        ?.status,
    ).toBe("canceled");
  });

  it("rejects a workspace member as inviter", async () => {
    const ctx = await setupOwner();
    await expect(
      createWorkspaceInvitation(
        ctx.env,
        jsonRequest({ email: "outsider@example.test", role: "member" }),
        {
          principal: { ...ctx.principal, role: "member" },
          requestId: crypto.randomUUID(),
          workspaceId: ctx.workspaceId,
        },
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it("rejects inviting someone who is already a member", async () => {
    const ctx = await setupOwner();
    await expect(
      createWorkspaceInvitation(
        ctx.env,
        jsonRequest({
          email: `${ctx.identity.userId}@example.test`,
          role: "member",
        }),
        {
          principal: ctx.principal,
          requestId: crypto.randomUUID(),
          workspaceId: ctx.workspaceId,
        },
      ),
    ).rejects.toThrow(/already belongs/u);
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
