import assert from "node:assert/strict";
import test from "node:test";

import {
  activeWorkspaceCreateKey,
  hasActiveWorkspaceCreateSession,
  isExplicitWorkspaceEntry,
  shouldRestoreWorkspaceCreate,
  shouldResumeWorkspaceCreate,
  shouldStayOnWorkspaceCreate,
} from "../src/lib/workspace-entry.js";

void test("treats add and both invitation routes as intentional workspace entry", () => {
  assert.equal(isExplicitWorkspaceEntry(""), false);
  assert.equal(isExplicitWorkspaceEntry("?intent=add"), true);
  assert.equal(isExplicitWorkspaceEntry("?intent=create"), true);
  assert.equal(
    isExplicitWorkspaceEntry("?invite=chief-desktop%3A%2F%2Fjoin"),
    true,
  );
  assert.equal(
    isExplicitWorkspaceEntry(
      "?organizationInvite=chief-desktop%3A%2F%2Forganization-invite",
    ),
    true,
  );
  assert.equal(isExplicitWorkspaceEntry("?intent=onboarding"), false);
});

void test("resumes workspace creation only on the relay that was selected", () => {
  assert.equal(
    shouldResumeWorkspaceCreate(
      "https://relay.example.com/path",
      "https://relay.example.com",
    ),
    true,
  );
  assert.equal(
    shouldResumeWorkspaceCreate(
      "https://relay.example.com",
      "https://other.example.com",
    ),
    false,
  );
  assert.equal(
    shouldResumeWorkspaceCreate("not a URL", "https://relay.example.com"),
    false,
  );
  assert.equal(
    shouldResumeWorkspaceCreate(null, "https://relay.example.com"),
    false,
  );
});

void test("restores a workspace draft only during the active flow or a relay handoff", () => {
  assert.equal(shouldRestoreWorkspaceCreate("active", false), true);
  assert.equal(shouldRestoreWorkspaceCreate(null, true), true);
  assert.equal(shouldRestoreWorkspaceCreate(null, false), false);
  assert.equal(shouldRestoreWorkspaceCreate("stale", false), false);
  assert.equal(shouldRestoreWorkspaceCreate("active", false, true), false);
  assert.equal(
    activeWorkspaceCreateKey("relay:user"),
    "chief.active-workspace-create.v1:relay:user",
  );
});

void test("keeps an in-progress workspace create on the create route", () => {
  const values = new Map<string, string>([
    [activeWorkspaceCreateKey("draft"), "active"],
  ]);
  const storage = {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
  };
  const empty = {
    length: 0,
    key: () => null,
    getItem: () => null,
  };

  assert.equal(hasActiveWorkspaceCreateSession(storage), true);
  assert.equal(shouldStayOnWorkspaceCreate("", storage), true);
  assert.equal(shouldStayOnWorkspaceCreate("?intent=create", empty), true);
  assert.equal(shouldStayOnWorkspaceCreate("", empty), false);
});
