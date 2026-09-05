import assert from "node:assert/strict";
import test from "node:test";

import { RelayClient } from "@chief/relay-client";
import {
  workspaceIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import {
  beginRelayConnection,
  beginWorkspaceTransition,
  completeRelayConnection,
  failRelayConnection,
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

void test("a retry with only an account client stays behind the loading boundary", () => {
  const client = new RelayClient({
    relayUrl: "https://relay.example.com",
    getAuthorization: () => Promise.resolve("authorization"),
  });
  const state = beginRelayConnection(
    {
      accountId: "account-one",
      client,
      snapshot: null,
      workspaces: [],
      loading: false,
      error: "This relay is unavailable.",
    },
    "account-one",
  );

  assert.equal(state.loading, true);
  assert.equal(state.error, null);
  assert.equal(state.client, client);
});

void test("a background refresh keeps an available workspace visible", () => {
  const client = new RelayClient({
    relayUrl: "https://relay.example.com",
    getAuthorization: () => Promise.resolve("authorization"),
  });
  const state = beginRelayConnection(
    {
      accountId: "account-one",
      client,
      snapshot,
      workspaces: [],
      loading: false,
      error: null,
    },
    "account-one",
    "background",
  );

  assert.equal(state.loading, false);
  assert.equal(state.snapshot, snapshot);
});

void test("a background refresh does not remount workspace creation", () => {
  const client = new RelayClient({
    relayUrl: "https://relay.example.com",
    getAuthorization: () => Promise.resolve("authorization"),
  });
  const current = {
    accountId: "account-one",
    client,
    snapshot: null,
    workspaces: [],
    loading: false,
    error: null,
  };

  const state = beginRelayConnection(current, "account-one", "background");

  assert.equal(state, current);
  assert.equal(state.loading, false);
  assert.equal(state.client, client);
});

void test("a failed background refresh preserves the visible application", () => {
  const client = new RelayClient({
    relayUrl: "https://relay.example.com",
    getAuthorization: () => Promise.resolve("authorization"),
  });
  const current = {
    accountId: "account-one",
    client,
    snapshot: null,
    workspaces: [],
    loading: false,
    error: null,
  };

  const state = failRelayConnection(
    current,
    "account-one",
    "This relay is unavailable.",
    "background",
  );

  assert.equal(state, current);
  assert.equal(state.error, null);
  assert.equal(state.loading, false);
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

void test("refocus refresh preserves the live client but workspace/account changes replace it", () => {
  const createClient = () =>
    new RelayClient({
      relayUrl: "https://relay.example.com",
      getAuthorization: () => Promise.resolve("authorization"),
    });
  const current = {
    accountId: "account-one",
    client: createClient(),
    snapshot,
    workspaces: [],
    loading: false,
    error: null,
  };
  const next = {
    ...current,
    client: createClient(),
    snapshot: { ...snapshot, name: "Refreshed" },
  };
  const refreshed = completeRelayConnection(current, next);
  assert.equal(refreshed.client, current.client);
  assert.equal(refreshed.snapshot, next.snapshot);
  assert.equal(
    completeRelayConnection(current, {
      ...next,
      snapshot: { ...snapshot, id: workspaceIdSchema.parse("workspace-two") },
    }).client,
    next.client,
  );
  assert.equal(
    completeRelayConnection(current, { ...next, accountId: "account-two" })
      .client,
    next.client,
  );
});
