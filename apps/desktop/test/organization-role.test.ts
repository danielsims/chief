import assert from "node:assert/strict";
import test from "node:test";

import {
  canDeleteChannels,
  canManageChannels,
  organizationRoles,
  primaryOrganizationRole,
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
