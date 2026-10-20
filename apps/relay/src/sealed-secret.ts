/**
 * Secrets at rest, sealed with AES-256-GCM.
 *
 *  - Each purpose derives its own key from RELAY_SECRET_KEY with HKDF-SHA-256
 *    and a distinct info string, so one purpose's key never opens another's.
 *  - The additional data names the row a secret belongs to, so a ciphertext
 *    copied to another row or workspace fails to open.
 *  - Envelopes are `version.iv.ciphertext`, base64 encoded.
 */
export interface SealPurpose {
  /** HKDF info string, e.g. "chief/mcp-credentials/v1". */
  info: string;
  /** Envelope prefix, so a future scheme can be told apart. */
  version: string;
}

const keys = new Map<string, Promise<CryptoKey>>();

function purposeKey(master: string, purpose: SealPurpose) {
  if (!master || master.length < 16)
    throw new Error("Stored secrets require a strong RELAY_SECRET_KEY.");
  const cacheKey = `${purpose.info}\u0000${master}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", new TextEncoder().encode(master), "HKDF", false, [
        "deriveKey",
      ])
      .then((material) =>
        crypto.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(32),
            info: new TextEncoder().encode(purpose.info),
          },
          material,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    keys.set(cacheKey, key);
  }
  return key;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sealSecret(
  master: string,
  purpose: SealPurpose,
  additionalData: string,
  plaintext: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(additionalData),
      },
      await purposeKey(master, purpose),
      new TextEncoder().encode(plaintext),
    ),
  );
  return [purpose.version, toBase64(iv), toBase64(sealed)].join(".");
}

export async function openSecret(
  master: string,
  purpose: SealPurpose,
  additionalData: string,
  envelope: string,
) {
  const [version, iv, sealed] = envelope.split(".");
  if (version !== purpose.version || !iv || !sealed)
    throw new Error("A stored secret is unreadable.");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(iv),
        additionalData: new TextEncoder().encode(additionalData),
      },
      await purposeKey(master, purpose),
      fromBase64(sealed),
    ),
  );
}
