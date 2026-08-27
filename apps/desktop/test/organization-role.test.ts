import assert from "node:assert/strict";
import test from "node:test";

import {
  canDeleteChannels,
  canManageChannels,
  organizationRoles,
  primaryOrganizationRole,
  workspaceRoleForUser,
} from "../src/lib/auth/organization-role";

void test("organization roles normalize Better Auth role values", () => {
  assert.deepEqual(organizationRoles("member, admin"), ["member", "admin"]);
  assert.deepEqual(organizationRoles(["member", "owner"]), ["member", "owner"]);
  assert.equal(primaryOrganizationRole("member,admin"), "admin");
  assert.equal(primaryOrganizationRole("unknown"), null);
});

void test("channel management follows workspace roles", () => {
  assert.equal(canManageChannels("owner"), true);
  assert.equal(canManageChannels("admin"), true);
  assert.equal(canManageChannels("member"), false);
  assert.equal(canDeleteChannels("owner"), true);
  assert.equal(canDeleteChannels("admin"), false);
});

void test("resolves the signed-in user's authoritative workspace role", () => {
  const members = [
    { kind: "user" as const, principalId: "owner", role: "owner" as const },
    { kind: "user" as const, principalId: "member", role: "member" as const },
    { kind: "agent" as const, principalId: "chief", role: "member" as const },
  ];

  assert.equal(workspaceRoleForUser(members, "owner"), "owner");
  assert.equal(workspaceRoleForUser(members, "member"), "member");
  assert.equal(workspaceRoleForUser(members, "unknown"), null);
  assert.equal(workspaceRoleForUser(members, null), null);
});
