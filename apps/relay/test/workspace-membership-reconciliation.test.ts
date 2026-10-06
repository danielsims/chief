import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureChiefOrganization,
  ensureChiefOrganizationMember,
  updateChiefOrganizationMemberRole,
} from "@chief/auth/d1-organizations";
import {
  userIdSchema,
  workspaceListResultSchema,
  workspaceMemberListSchema,
} from "@chief/relay-contracts";

import { routeAgentRequest } from "../src/router-agent-routes";
import * as RouterAuth from "../src/router-auth";
import { listManagedWorkspaces } from "../src/workspace-authority";
import { setupChannelTest } from "./channel-test-helpers";
import { hexKey } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

function chiefAccountEnv(env: Env): Env {
  return { ...env, ACCOUNT_IDENTITY_MODE: "chief-account" };
}

describe("workspace membership reconciliation", () => {
  it("lists a Better Auth organization member who never joined the relay", async () => {
    const ctx = await setupChannelTest();
    const env = chiefAccountEnv(ctx.env);
    const organizationMemberId = userIdSchema.parse(
      `web-invitee-${crypto.randomUUID()}`,
    );
    await Promise.all([
      insertUser(env.AUTH_DB, ctx.identity.userId),
      insertUser(env.AUTH_DB, organizationMemberId),
    ]);
    await ensureChiefOrganization(env.AUTH_DB, {
      name: "Channel test",
      ownerUserId: ctx.identity.userId,
      website: "https://heychief.sh",
      workspaceId: ctx.workspaceId,
    });
    await ensureChiefOrganizationMember(env.AUTH_DB, {
      organizationId: ctx.workspaceId,
      userId: organizationMemberId,
    });
    // The relay Durable Object must stay authoritative for a principal's role,
    // so give the owner a different Better Auth role and keep the relay role.
    await updateChiefOrganizationMemberRole(env.AUTH_DB, {
      organizationId: ctx.workspaceId,
      role: "admin",
      userId: ctx.identity.userId,
    });

    vi.spyOn(RouterAuth, "authenticateRelayRequest").mockImplementation(
      async (request) => ({ identity: ctx.identity, request, bound: true }),
    );

    const response = await routeAgentRequest(
      env,
      new Request(
        `https://relay.test/v1/workspaces/${ctx.workspaceId}/members`,
      ),
      crypto.randomUUID(),
    );
    if (!response) throw new Error("The members route did not respond.");
    expect(response.status).toBe(200);
    const { members } = workspaceMemberListSchema.parse(await response.json());

    expect(
      members.find((member) => member.principalId === organizationMemberId),
    ).toEqual({
      kind: "user",
      principalId: organizationMemberId,
      role: "member",
      name: organizationMemberId,
      email: `${organizationMemberId}@example.test`,
    });
    const owners = members.filter(
      (member) => member.principalId === ctx.identity.userId,
    );
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ kind: "user", role: "owner" });
  });

  it("adds an organization the user joined on the web but never on a device", async () => {
    const ctx = await setupChannelTest();
    const env = chiefAccountEnv(ctx.env);
    const memberId = userIdSchema.parse(
      `directory-member-${crypto.randomUUID()}`,
    );
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
    const identity = {
      kind: "user" as const,
      userId: memberId,
      pubkey: hexKey(memberId),
    };

    const first = workspaceListResultSchema.parse(
      await (await listManagedWorkspaces(env, identity)).json(),
    );
    expect(first.workspaces).toHaveLength(1);
    expect(first.workspaces[0]).toMatchObject({
      id: ctx.workspaceId,
      name: "Channel test",
    });

    // A second list must not re-join, duplicate, or reorder the workspace.
    const second = workspaceListResultSchema.parse(
      await (await listManagedWorkspaces(env, identity)).json(),
    );
    expect(second.workspaces).toHaveLength(1);
    expect(
      second.workspaces.filter((workspace) => workspace.id === ctx.workspaceId),
    ).toHaveLength(1);
  });
});

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
