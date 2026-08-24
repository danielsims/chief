import assert from "node:assert/strict";
import test from "node:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import {
  isJsonNumber,
  isJsonString,
  parseJsonObject,
} from "@chief/relay-contracts";

import { createNip98Authorization, nip98PublicKey } from "../src/nip98-signer";

interface Nip98Event {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

void test("signs one exact request without exposing the agent secret", () => {
  const secret = new Uint8Array(32).fill(7);
  const body = JSON.stringify({ hello: "world" });
  const authorization = createNip98Authorization(secret, {
    url: "https://relay.example/v1/workspaces/workspace-a/messages",
    method: "post",
    body,
  });
  const event = parseNip98Event(
    JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    ),
  );
  const expectedId = bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([
          0,
          event.pubkey,
          event.created_at,
          event.kind,
          event.tags,
          event.content,
        ]),
      ),
    ),
  );

  assert.equal(event.pubkey, nip98PublicKey(secret));
  assert.equal(event.id, expectedId);
  assert.equal(event.tags.find(([name]) => name === "method")?.[1], "POST");
  assert.equal(
    event.tags.find(([name]) => name === "payload")?.[1],
    bytesToHex(sha256(new TextEncoder().encode(body))),
  );
  assert.equal(
    schnorr.verify(
      hexToBytes(event.sig),
      hexToBytes(event.id),
      hexToBytes(event.pubkey),
    ),
    true,
  );
  assert.equal(authorization.includes(bytesToHex(secret)), false);
});

function parseNip98Event(value: unknown): Nip98Event {
  const object = parseJsonObject(value);
  if (!object) throw new Error("NIP-98 event must be a JSON object.");
  const tags = object.tags;
  if (
    !isJsonString(object.id) ||
    !isJsonString(object.pubkey) ||
    !isJsonNumber(object.created_at) ||
    !isJsonNumber(object.kind) ||
    !Array.isArray(tags) ||
    !tags.every(
      (tag) => Array.isArray(tag) && tag.every((entry) => isJsonString(entry)),
    ) ||
    !isJsonString(object.content) ||
    !isJsonString(object.sig)
  ) {
    throw new Error("NIP-98 event has an invalid shape.");
  }
  return {
    id: object.id,
    pubkey: object.pubkey,
    created_at: object.created_at,
    kind: object.kind,
    tags,
    content: object.content,
    sig: object.sig,
  };
}
