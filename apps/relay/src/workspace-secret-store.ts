import { z } from "zod";

import { HttpError } from "./http";

/**
 * Workspace-scoped encrypted secrets, modelled on Executor's encrypted-secrets
 * plugin (AES-256-GCM, master-key-derived key, per-value random IV + auth tag
 * alongside the ciphertext) but implemented with WebCrypto because the relay
 * is a Cloudflare Worker.
 *
 *  - Values are encrypted at rest in the workspace Durable Object's SQLite.
 *  - A secret is entered once against a workspace and referenced by name from
 *    agent inference config. No secret is ever shared across workspaces: the
 *    row key is namespaced by workspace_id and the ciphertext is bound to the
 *    relay master key.
 *  - The master key comes from the Worker secret RELAY_SECRET_KEY. A
 *    secret store with no key is unsafe, so construction fails loudly.
 */
const COLLECTION = "workspace_secrets";
const KEY_SALT = "chief-workspace-secrets/v1";
const PAYLOAD_VERSION = "v1";
const KEY_ITERATIONS = 210_000;

const SECRET_NAME = /^[a-z][a-z0-9._-]{0,119}$/u;

async function deriveKey(master: string): Promise<CryptoKey> {
  const salt = new TextEncoder().encode(KEY_SALT);
  const base = new TextEncoder().encode(`${KEY_SALT}\u0000${master}`);
  const rawKey = await crypto.subtle.importKey("raw", base, "PBKDF2", false, [
    "deriveKey",
  ]);
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations: KEY_ITERATIONS, salt },
    rawKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

interface SecretRow extends Record<string, SqlStorageValue> {
  key: string;
  value_json: string;
  updated_at: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function encryptSecret(
  key: CryptoKey,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  // WebCrypto AES-GCM appends the 16-byte auth tag to the ciphertext.
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return [PAYLOAD_VERSION, toBase64(iv), toBase64(sealed)].join(".");
}

async function decryptSecret(key: CryptoKey, payload: string): Promise<string> {
  const parts = payload.split(".");
  if ((parts[0] ?? "") !== PAYLOAD_VERSION) {
    throw new Error("The secret payload version is not supported.");
  }
  const iv = fromBase64(parts[1] ?? "");
  const sealed = fromBase64(parts[2] ?? "");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    sealed,
  );
  return new TextDecoder().decode(plaintext);
}

/** One workspace-scoped secret store backed by the workspace DO's SQLite. */
export class WorkspaceSecretStore {
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(
    private readonly storage: DurableObjectStorage,
    masterKey: string,
  ) {
    if (!masterKey || masterKey.length < 16) {
      throw new Error(
        "A workspace secret store requires a strong RELAY_SECRET_KEY.",
      );
    }
    this.keyPromise = deriveKey(masterKey);
  }

  private rowKey(workspaceId: string, name: string): string {
    return `${COLLECTION}:${workspaceId}:${name}`;
  }

  async set(workspaceId: string, name: string, value: string) {
    const normalized = validateSecretName(name);
    const key = await this.keyPromise;
    const ciphertext = await encryptSecret(key, value);
    const now = new Date().toISOString();
    this.storage.sql.exec(
      `INSERT INTO secrets (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      this.rowKey(workspaceId, normalized),
      JSON.stringify(ciphertext),
      now,
    );
  }

  async get(workspaceId: string, name: string): Promise<string | null> {
    const normalized = validateSecretName(name);
    const row = this.firstRow<SecretRow>(
      this.storage.sql.exec(
        "SELECT key, value_json, updated_at FROM secrets WHERE key = ?",
        this.rowKey(workspaceId, normalized),
      ),
    );
    if (!row) return null;
    const key = await this.keyPromise;
    // Stored ciphertext is guaranteed to be a JSON-encoded string: set() writes
    // it through JSON.stringify, so a non-string here is a storage corruption.
    const ciphertext = z.string().parse(JSON.parse(String(row.value_json)));
    return decryptSecret(key, ciphertext);
  }

  list(workspaceId: string): { name: string; updatedAt: string }[] {
    const prefix = `${COLLECTION}:${workspaceId}:`;
    const rows = this.storage.sql
      .exec<SecretRow>(
        "SELECT key, value_json, updated_at FROM secrets WHERE key LIKE ? ORDER BY key",
        `${prefix}%`,
      )
      .toArray();
    return rows.map((row) => ({
      name: String(row.key).slice(prefix.length),
      updatedAt: String(row.updated_at),
    }));
  }

  delete(workspaceId: string, name: string) {
    const normalized = validateSecretName(name);
    this.storage.sql.exec(
      "DELETE FROM secrets WHERE key = ?",
      this.rowKey(workspaceId, normalized),
    );
  }

  private firstRow<T>(cursor: Iterable<T>) {
    const row = cursor[Symbol.iterator]().next();
    return row.done ? undefined : row.value;
  }
}

function validateSecretName(name: string): string {
  const normalized = name.trim();
  if (!SECRET_NAME.test(normalized)) {
    throw new HttpError(
      400,
      "invalid_secret_name",
      "Secret names must be lowercase a-z, digits, dots, underscores, or dashes.",
    );
  }
  return normalized;
}

export { deriveKey, decryptSecret, encryptSecret };
