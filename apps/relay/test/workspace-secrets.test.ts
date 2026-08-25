import { describe, expect, it } from "vitest";

import { WorkspaceSecretStore } from "../src/workspace-secret-store";

const MASTER = "test-relay-secret-master-key-0123456789abcdef";

function makeStore() {
  // The test uses a fake storage that only needs the SQL surface the store
  // touches. We bypass the DurableObject SQLite by constructing the store with
  // a minimal mocked storage object.
  const rows = new Map<string, string>();
  const exec = (query: string, ...params: string[]) => {
    if (query.startsWith("SELECT") && query.includes("WHERE key = ?")) {
      const key = params[0] ?? "";
      const value = rows.get(key);
      if (!value) return createCursor([]);
      return createCursor([
        { key, value_json: value, updated_at: "2026-08-25T00:00:00.000Z" },
      ]);
    }
    if (query.startsWith("SELECT") && query.includes("LIKE ?")) {
      const pattern = params[0] ?? "";
      const prefix = pattern.endsWith("%") ? pattern.slice(0, -1) : pattern;
      const entries = [...rows.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({
          key,
          value_json: value,
          updated_at: "2026-08-25T00:00:00.000Z",
        }));
      return createCursor(entries);
    }
    if (query.startsWith("INSERT") || query.startsWith("UPDATE")) {
      rows.set(params[0] ?? "", params[1] ?? "");
      return createCursor([]);
    }
    if (query.startsWith("DELETE")) {
      rows.delete(params[0] ?? "");
      return createCursor([]);
    }
    return createCursor([]);
  };
  const mockStorage = { sql: { exec } };
  // The store only touches the SQL surface above, so the fake is a valid
  // stand-in for the DurableObjectStorage in this isolated test.
  const storage = mockStorage as DurableObjectStorage;
  return { store: new WorkspaceSecretStore(storage, MASTER), rows };
}

function createCursor<T>(rows: T[]) {
  let index = 0;
  return {
    [Symbol.iterator]() {
      return {
        next() {
          if (index < rows.length) return { value: rows[index++], done: false };
          return { value: undefined, done: true };
        },
      };
    },
    toArray() {
      return rows;
    },
  };
}

describe("workspace secret store", () => {
  it("round-trips a value", async () => {
    const { store } = makeStore();
    await store.set("ws-a", "opencode", "sk-test-123");
    expect(await store.get("ws-a", "opencode")).toBe("sk-test-123");
  });

  it("stores ciphertext, not plaintext", async () => {
    const { store, rows } = makeStore();
    await store.set("ws-a", "opencode", "super-secret-api-key");
    const stored = [...rows.values()][0] ?? "";
    expect(stored).not.toContain("super-secret-api-key");
    expect(JSON.parse(stored)).toMatch(/^v1\./u);
  });

  it("isolates secrets across workspaces", async () => {
    const { store } = makeStore();
    await store.set("ws-a", "opencode", "key-a");
    await store.set("ws-b", "opencode", "key-b");
    expect(await store.get("ws-a", "opencode")).toBe("key-a");
    expect(await store.get("ws-b", "opencode")).toBe("key-b");
    expect(await store.get("ws-a", "opencode")).not.toBe("key-b");
  });

  it("deletes a secret", async () => {
    const { store } = makeStore();
    await store.set("ws-a", "opencode", "key-a");
    store.delete("ws-a", "opencode");
    expect(await store.get("ws-a", "opencode")).toBeNull();
  });

  it("lists only that workspace's secrets", async () => {
    const { store } = makeStore();
    await store.set("ws-a", "opencode", "k");
    await store.set("ws-a", "openai", "k");
    await store.set("ws-b", "opencode", "k");
    const names = store.list("ws-a").map((secret) => secret.name);
    expect([...names].sort()).toEqual(["openai", "opencode"]);
  });

  it("fails loudly without a master key", () => {
    expect(
      () => new WorkspaceSecretStore({} as DurableObjectStorage, ""),
    ).toThrow(/RELAY_SECRET_KEY/u);
  });
});
