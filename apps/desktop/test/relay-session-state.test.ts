import assert from "node:assert/strict";
import test from "node:test";

import { workspaceSnapshotSchema } from "@chief/relay-contracts";

import {
  beginWorkspaceTransition,
  workspaceSummaryFromSnapshot,
} from "../src/lib/relay-session-state.js";

const snapshot = workspaceSnapshotSchema.parse({
  id: "workspace-one",
  name: "One",
  website: "https://example.com",
  selectedApps: [],
  runtime: "cloud",
  imageURL: null,
  onboardingComplete: true,
  conversations: [],
  agents: [],
  projects: [],
  createdAt: "2026-08-28T00:00:00.000Z",
});

void test("workspace transitions retain the current screen while loading", () => {
  const state = beginWorkspaceTransition({
    accountId: "account-one",
    client: null,
    snapshot,
    workspaces: [],
    loading: false,
    error: "stale error",
  });

  assert.equal(state.loading, true);
  assert.equal(state.error, null);
  assert.equal(state.snapshot, snapshot);
});

void test("a created workspace can be adopted before background setup", () => {
  assert.deepEqual(workspaceSummaryFromSnapshot(snapshot), {
    id: "workspace-one",
    name: "One",
    website: "https://example.com",
    imageURL: null,
    isActive: true,
    onboardingComplete: true,
  });
});
