import assert from "node:assert/strict";
import test from "node:test";

import type { StoredSession } from "../src/lib/auth/session";

void test("Keychain approval can take longer than twelve seconds without failing sign-in", async (context) => {
  const originals = new Map(
    ["localStorage", "sessionStorage", "window", "isTauri"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  let finishApproval!: (session: StoredSession) => void;
  const approval = new Promise<StoredSession>((resolve) => {
    finishApproval = resolve;
  });
  let reads = 0;
  for (const [key, value] of Object.entries({
    localStorage: storage,
    sessionStorage: storage,
    isTauri: true,
    window: {
      dispatchEvent: () => true,
      __TAURI_INTERNALS__: {
        invoke: (command: string) => {
          assert.equal(command, "load_oauth_session");
          reads++;
          return approval;
        },
      },
    },
  }))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  context.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { hydrateStoredSession } = await import("../src/lib/auth/session");
    const first = hydrateStoredSession();
    const second = hydrateStoredSession();
    let settled = false;
    void first.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    context.mock.timers.tick(13_000);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(
      settled,
      false,
      "The native prompt is still waiting for the user",
    );
    assert.equal(
      reads,
      1,
      "Concurrent startup consumers share the same Keychain read",
    );
    const session: StoredSession = {
      token: "local-test-token",
      user: {
        id: "owner",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
      },
      lastValidated: 0,
    };
    finishApproval(session);
    assert.deepEqual(await first, session);
    assert.deepEqual(await second, session);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
