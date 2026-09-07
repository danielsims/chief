import { describe, expect, it } from "vitest";

import { relayDatabase } from "../src/db/connection";
import { secrets } from "../src/db/schema/secrets";
import {
  decryptSecret,
  deriveKey,
  WorkspaceSecretStore,
} from "../src/workspace-secret-store";
import { withWorkspaceStorage } from "./sqlite-test-storage";

const MASTER = "test-relay-secret-master-key-0123456789abcdef";

describe("workspace secret store", () => {
  it("decrypts the portable v2 PBKDF2 and AES-GCM envelope", async () => {
    const key = await deriveKey(MASTER);
    const payload =
      "v2.AAECAwQFBgcICQoL.DmDA97aj0MZts0pCiDbBpHDCJgFyGZrlkFti9FpQQQ==";
    expect(await decryptSecret(key, payload)).toBe("portable-secret");
  });

  it("round-trips a value", async () =>
    withWorkspaceStorage(async (storage) => {
      const store = new WorkspaceSecretStore(storage, MASTER);
      await store.set("ws-a", "opencode", "sk-test-123");
      expect(await store.get("ws-a", "opencode")).toBe("sk-test-123");
    }));

  it("stores ciphertext, not plaintext", async () =>
    withWorkspaceStorage(async (storage) => {
      const store = new WorkspaceSecretStore(storage, MASTER);
      await store.set("ws-a", "opencode", "super-secret-api-key");
      const stored =
        relayDatabase(storage).select().from(secrets).all()[0]?.value_json ??
        "";
      expect(stored).not.toContain("super-secret-api-key");
      expect(JSON.parse(stored)).toMatch(/^v2\./u);
    }));

  it("isolates secrets across workspaces", async () =>
    withWorkspaceStorage(async (storage) => {
      const store = new WorkspaceSecretStore(storage, MASTER);
      await store.set("ws-a", "opencode", "key-a");
      await store.set("ws-b", "opencode", "key-b");
      expect(await store.get("ws-a", "opencode")).toBe("key-a");
      expect(await store.get("ws-b", "opencode")).toBe("key-b");
      expect(await store.get("ws-a", "opencode")).not.toBe("key-b");
    }));

  it("deletes a secret", async () =>
    withWorkspaceStorage(async (storage) => {
      const store = new WorkspaceSecretStore(storage, MASTER);
      await store.set("ws-a", "opencode", "key-a");
      store.delete("ws-a", "opencode");
      expect(await store.get("ws-a", "opencode")).toBeNull();
    }));

  it("lists only that workspace's secrets", async () =>
    withWorkspaceStorage(async (storage) => {
      const store = new WorkspaceSecretStore(storage, MASTER);
      await store.set("ws-a", "opencode", "k");
      await store.set("ws-a", "openai", "k");
      await store.set("ws-b", "opencode", "k");
      const names = store.list("ws-a").map((secret) => secret.name);
      expect([...names].sort()).toEqual(["openai", "opencode"]);
    }));

  it("fails loudly without a master key", () => {
    expect(
      () => new WorkspaceSecretStore({} as DurableObjectStorage, ""),
    ).toThrow(/RELAY_SECRET_KEY/u);
  });
});
