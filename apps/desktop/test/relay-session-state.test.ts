import assert from "node:assert/strict";
import test from "node:test";

import { RelayClient } from "@chief/relay-client";
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
  const client = new RelayClient({
    relayUrl: "https://relay.example.com",
    getAuthorization: () => Promise.resolve("authorization"),
  });
  const state = beginWorkspaceTransition({
    accountId: "account-one",
    client,
    snapshot,
    workspaces: [],
    loading: false,
    error: "stale error",
  });

  assert.equal(state.loading, true);
  assert.equal(state.error, null);
  assert.equal(state.snapshot, snapshot);
  assert.equal(state.client, null);
});

void test("a workspace snapshot produces directory metadata", () => {
  assert.deepEqual(workspaceSummaryFromSnapshot(snapshot), {
    id: "workspace-one",
    name: "One",
    website: "https://example.com",
    imageURL: null,
    isActive: true,
    onboardingComplete: true,
  });
});
