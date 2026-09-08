import assert from "node:assert/strict";
import test from "node:test";

import {
  activeRelayUserId,
  connectedRelayIdentities,
  rememberRelayAccount,
  resetAccountDirectoryForTests,
} from "../src/lib/auth/account-directory.js";

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

void test("keeps one independent identity for each relay", () => {
  withStorage(() => {
    rememberRelayAccount("https://cloud.example", {
      id: "cloud-user",
      name: "Workspace Owner",
      email: "Workspace@example.com",
      emailVerified: true,
    });
    rememberRelayAccount("https://relay.example", {
      id: "relay-user",
      name: "Workspace Owner",
      email: "owner@example.com",
      emailVerified: true,
    });

    assert.deepEqual(
      connectedRelayIdentities()
        .map((identity) => identity.user.id)
        .sort(),
      ["cloud-user", "relay-user"],
    );
  });
});

void test("a relay retains only its most recently signed-in account", () => {
  withStorage(() => {
    rememberRelayAccount("https://relay.example", {
      id: "first",
      name: "First",
      email: "first@example.com",
      emailVerified: true,
    });
    rememberRelayAccount("https://relay.example", {
      id: "second",
      name: "Second",
      email: "second@example.com",
      emailVerified: true,
    });

    assert.deepEqual(
      connectedRelayIdentities().map((identity) => identity.user.id),
      ["second"],
    );
    assert.equal(activeRelayUserId("https://relay.example"), "second");
  });
});

function withStorage(run: () => void): void {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  try {
    resetAccountDirectoryForTests();
    run();
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previous,
    });
  }
}
