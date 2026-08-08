import assert from "node:assert/strict";
import test from "node:test";

import { nextWorkspaceMenuId } from "../src/components/workspace-action-menu.tsx";
import { activeFirstOrganizations } from "../src/lib/workspace-organizations.js";

const organizations = [
  { id: "first", name: "First", slug: "first", logo: "first.png" },
  { id: "active", name: "Active", slug: "active", logo: "active.png" },
  { id: "third", name: "Third", slug: "third", logo: "third.png" },
];

void test("places the active organization first without reordering the rest", () => {
  assert.deepEqual(
    activeFirstOrganizations(organizations, "active").map(
      (organization) => organization.id,
    ),
    ["active", "first", "third"],
  );
});

void test("preserves organization order when the active id is unavailable", () => {
  assert.deepEqual(
    activeFirstOrganizations(organizations, "missing").map(
      (organization) => organization.id,
    ),
    ["first", "active", "third"],
  );
});

void test("a stale close cannot dismiss the newly hovered workspace menu", () => {
  const newlyOpened = nextWorkspaceMenuId("first", "second", true);
  assert.equal(newlyOpened, "second");
  assert.equal(nextWorkspaceMenuId(newlyOpened, "first", false), "second");
  assert.equal(nextWorkspaceMenuId(newlyOpened, "second", false), null);
});
