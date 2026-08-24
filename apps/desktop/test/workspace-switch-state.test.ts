import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceSummary } from "@chief/relay-contracts";
import { workspaceSummarySchema } from "@chief/relay-contracts";

import { rememberRelayWorkspaces } from "../src/lib/relay-connection.js";
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
    rememberRelayWorkspaces("https://offline.example", [offline, offlinePeer]);
    rememberRelayWorkspaces("https://unknown.example", [unknown]);
    rememberConnectedWorkspace({
      workspaceId: offline.id,
      relayUrl: "https://offline.example",
    });

    assert.equal(
      findRecoveryWorkspace(
        [offline, offlinePeer, unknown],
        "https://offline.example",
      )?.id,
      unknown.id,
    );

    rememberConnectedWorkspace({
      workspaceId: unknown.id,
      relayUrl: "https://unknown.example",
    });
    assert.deepEqual(previousWorkspaceSwitch(), {
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
    rememberRelayWorkspaces("https://relay.example", [program, unavailable]);
    rememberConnectedWorkspace({
      workspaceId: program.id,
      relayUrl: "https://relay.example",
    });
    rememberConnectedWorkspace({
      workspaceId: unavailable.id,
      relayUrl: "https://relay.example",
    });

    assert.equal(
      findRecoveryWorkspace([program, unavailable], "https://relay.example")
        ?.id,
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
