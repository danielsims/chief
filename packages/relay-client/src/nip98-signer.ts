import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

const NIP98_KIND = 27_235;

export function nip98PublicKey(secretKey: string | Uint8Array) {
  return bytesToHex(schnorr.getPublicKey(secretBytes(secretKey)));
}

/** Creates a one-request NIP-98 authorization. The secret never leaves the
 * caller's agent cell; RelayClient receives only this short-lived header. */
export function createNip98Authorization(
  secretKey: string | Uint8Array,
  request: { url: string; method: string; body: string },
) {
  const key = secretBytes(secretKey);
  const pubkey = nip98PublicKey(key);
  const tags = [
    ["u", request.url],
    ["method", request.method.toUpperCase()],
  ];
  if (request.body) {
    tags.push([
      "payload",
      bytesToHex(sha256(new TextEncoder().encode(request.body))),
    ]);
  }
  tags.push(["request", bytesToHex(randomBytes(16))]);
  const created_at = Math.floor(Date.now() / 1_000);
  const id = bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([0, pubkey, created_at, NIP98_KIND, tags, ""]),
      ),
    ),
  );
  const event = {
    id,
    pubkey,
    content: "",
    kind: NIP98_KIND,
    created_at,
    tags,
    sig: bytesToHex(schnorr.sign(hexToBytes(id), key)),
  };
  return `Nostr ${base64(new TextEncoder().encode(JSON.stringify(event)))}`;
}

function secretBytes(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? hexToBytes(value) : value;
  if (bytes.length !== 32) throw new Error("Agent identity must be 32 bytes.");
  return bytes;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}
