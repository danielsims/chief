import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceSummary } from "@chief/relay-contracts";
import { workspaceSummarySchema } from "@chief/relay-contracts";

import {
  knownWorkspaceSummaries,
  relayForWorkspace,
  rememberRelayWorkspaces,
} from "../src/lib/relay-connection.js";
import {
  findRecoveryWorkspace,
  previousWorkspaceSwitch,
  rememberConnectedWorkspace,
} from "../src/lib/workspace-switch-state.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function workspace(id: string, isActive = false): WorkspaceSummary {
  return workspaceSummarySchema.parse({
    id,
    name: id,
    website: "",
    imageURL: null,
    isActive,
    onboardingComplete: true,
  });
}

void test("recovery uses an active workspace on another known relay", () => {
  const accountId = "account-one";
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage },
  });

  try {
    const offline = workspace("workspace-offline", true);
    const offlinePeer = workspace("workspace-offline-peer");
    const unknown = workspace("workspace-unknown", true);
    rememberRelayWorkspaces("https://offline.example", accountId, [
      offline,
      offlinePeer,
    ]);
    rememberRelayWorkspaces("https://unknown.example", accountId, [unknown]);
    rememberConnectedWorkspace(accountId, {
      workspaceId: offline.id,
      relayUrl: "https://offline.example",
    });

    assert.equal(
      findRecoveryWorkspace(
        accountId,
        [offline, offlinePeer, unknown],
        "https://offline.example",
      )?.id,
      unknown.id,
    );

    rememberConnectedWorkspace(accountId, {
      workspaceId: unknown.id,
      relayUrl: "https://unknown.example",
    });
    assert.deepEqual(previousWorkspaceSwitch(accountId), {
      version: 2,
      workspaceId: offline.id,
      relayUrl: "https://offline.example",
    });
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousLocalStorage,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});

void test("recovery can return to the previous workspace on the same relay", () => {
  const accountId = "account-one";
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage },
  });

  try {
    const program = workspace("workspace-program");
    const unavailable = workspace("workspace-unavailable", true);
    rememberRelayWorkspaces("https://relay.example", accountId, [
      program,
      unavailable,
    ]);
    rememberConnectedWorkspace(accountId, {
      workspaceId: program.id,
      relayUrl: "https://relay.example",
    });
    rememberConnectedWorkspace(accountId, {
      workspaceId: unavailable.id,
      relayUrl: "https://relay.example",
    });

    assert.equal(
      findRecoveryWorkspace(
        accountId,
        [program, unavailable],
        "https://relay.example",
      )?.id,
      program.id,
    );
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousLocalStorage,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});

void test("workspace directories remain isolated between signed-in accounts", () => {
  const previousLocalStorage = globalThis.localStorage;
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });

  try {
    const first = workspace("workspace-first");
    const second = workspace("workspace-second");
    rememberRelayWorkspaces("https://relay.example", "account-one", [first]);
    rememberRelayWorkspaces("https://relay.example", "account-two", [second]);

    assert.deepEqual(
      knownWorkspaceSummaries("https://relay.example", "account-one"),
      [first],
    );
    assert.deepEqual(
      knownWorkspaceSummaries("https://relay.example", "account-two"),
      [second],
    );
    assert.equal(
      relayForWorkspace("account-one", second.id),
      null,
      "one account cannot resolve another account's cached workspace",
    );
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousLocalStorage,
    });
  }
});

void test("workspace directories remain isolated between relay authorities", () => {
  const previousLocalStorage = globalThis.localStorage;
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });

  try {
    const accountId = "shared-account-id";
    const first = workspace("shared-workspace-id");
    const second = { ...first, name: "Second relay workspace" };
    rememberRelayWorkspaces("https://first.example", accountId, [first]);
    rememberRelayWorkspaces("https://second.example", accountId, [second]);

    assert.deepEqual(
      knownWorkspaceSummaries("https://first.example", accountId),
      [first],
    );
    assert.deepEqual(
      knownWorkspaceSummaries("https://second.example", accountId),
      [second],
    );
    assert.equal(
      relayForWorkspace(accountId, first.id),
      null,
      "an unscoped lookup fails closed when two relays issue the same IDs",
    );
    assert.equal(
      relayForWorkspace(accountId, first.id, "https://first.example"),
      "https://first.example",
    );
    assert.equal(
      relayForWorkspace(accountId, second.id, "https://second.example"),
      "https://second.example",
    );
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousLocalStorage,
    });
  }
});
