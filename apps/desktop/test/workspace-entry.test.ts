import assert from "node:assert/strict";
import test from "node:test";

import {
  activeWorkspaceCreateKey,
  exitWorkspaceSetup,
  hasActiveWorkspaceCreateSession,
  isExplicitWorkspaceEntry,
  pendingCreateRelayKey,
  pendingWorkspaceEntryIntentKey,
  resumeWorkspaceSetup,
  shouldRestoreWorkspaceCreate,
  shouldResumeWorkspaceCreate,
  shouldStayOnWorkspaceCreate,
  workspaceEntryIntent,
  workspaceSetupWasExited,
} from "../src/lib/workspace-entry.js";

void test("treats add and both invitation routes as intentional workspace entry", () => {
  assert.equal(isExplicitWorkspaceEntry(""), false);
  assert.equal(isExplicitWorkspaceEntry("?intent=add"), true);
  assert.equal(isExplicitWorkspaceEntry("?intent=create"), true);
  assert.equal(isExplicitWorkspaceEntry("?intent=join"), true);
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

void test("workspace entry starts directly in setup unless an invitation was requested", () => {
  assert.equal(workspaceEntryIntent(""), "create");
  assert.equal(workspaceEntryIntent("?intent=add"), "create");
  assert.equal(workspaceEntryIntent("?intent=create"), "create");
  assert.equal(workspaceEntryIntent("?intent=join"), "join");
  assert.equal(workspaceEntryIntent("?invite=invitation"), "join");
  assert.equal(workspaceEntryIntent("?organizationInvite=invitation"), "join");
});

void test("exiting stops forced setup redirects, preserves the draft and stays scoped to the account and workspace", () => {
  const values = new Map<string, string>([
    [pendingCreateRelayKey, "http://localhost:8080"],
    [pendingWorkspaceEntryIntentKey, "create"],
    [activeWorkspaceCreateKey("draft"), "active"],
    ["chief.workspace-setup.v1:draft", "saved draft"],
  ]);
  const storage: Storage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
  exitWorkspaceSetup(storage, "http://localhost:8080", "owner", "unfinished");
  assert.equal(
    shouldResumeWorkspaceCreate(
      storage.getItem(pendingCreateRelayKey),
      "http://localhost:8080",
    ),
    false,
  );
  assert.equal(hasActiveWorkspaceCreateSession(storage), false);
  assert.equal(
    storage.getItem("chief.workspace-setup.v1:draft"),
    "saved draft",
  );
  assert.equal(
    workspaceSetupWasExited(
      storage,
      "http://localhost:8080",
      "owner",
      "unfinished",
    ),
    true,
  );
  assert.equal(
    workspaceSetupWasExited(
      storage,
      "https://relay.heychief.sh",
      "owner",
      "unfinished",
    ),
    false,
  );
  assert.equal(
    workspaceSetupWasExited(
      storage,
      "http://localhost:8080",
      "other",
      "unfinished",
    ),
    false,
  );
  assert.equal(
    workspaceSetupWasExited(storage, "http://localhost:8080", "owner", "other"),
    false,
  );
  resumeWorkspaceSetup(storage, "http://localhost:8080", "owner");
  assert.equal(
    workspaceSetupWasExited(
      storage,
      "http://localhost:8080",
      "owner",
      "unfinished",
    ),
    false,
  );
  exitWorkspaceSetup(storage, "http://localhost:8080", "owner", null);
  assert.equal(
    workspaceSetupWasExited(storage, "http://localhost:8080", "owner", null),
    true,
  );
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
