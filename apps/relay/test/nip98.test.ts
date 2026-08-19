import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";

import { sha256PayloadTag, verifyNip98Auth } from "../src/nip98";

interface EventInput {
  pubkey: string;
  created_at: number;
  tags: string[][];
  content?: string;
  kind?: number;
}

function signEvent(input: EventInput) {
  const event = {
    pubkey: input.pubkey,
    content: input.content ?? "",
    kind: input.kind ?? 27235,
    created_at: input.created_at,
    tags: input.tags,
  };
  const id = bytesToHex(
    sha256(new TextEncoder().encode(JSON.stringify(event))),
  );
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), testSecretKey));
  return { id, ...event, sig };
}

function base64Event(event: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(event), "utf8").toString("base64");
}

// A fixed 32-byte secret key so tests are deterministic.
const testSecretKey = schnorr.utils.randomSecretKey();
// Nostr identity is the 32-byte x-only public key (BIP-340).
const pubkey = bytesToHex(schnorr.getPublicKey(testSecretKey));

const url = "https://chief-relay.example/v1/workspaces/ws-1/messages";
const method = "POST";

describe("verifyNip98Auth", () => {
  it("accepts a valid signed event", () => {
    const event = signEvent({
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", method],
      ],
    });
    const result = verifyNip98Auth(`Nostr ${base64Event(event)}`, {
      url,
      method,
    });
    expect(result).toBe(pubkey);
  });

  it("accepts a method tag in any case", () => {
    const event = signEvent({
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", "post"],
      ],
    });
    expect(
      verifyNip98Auth(`Nostr ${base64Event(event)}`, { url, method }),
    ).toBe(pubkey);
  });

  it("rejects a missing Authorization header", () => {
    expect(() => verifyNip98Auth(null, { url, method })).toThrow(
      /Authorization header is required/,
    );
  });

  it("rejects a non-Nostr scheme", () => {
    expect(() =>
      verifyNip98Auth(`Bearer ${base64Event({})}`, { url, method }),
    ).toThrow(/scheme must be Nostr/);
  });

  it("rejects malformed base64", () => {
    expect(() =>
      verifyNip98Auth("Nostr not-base64!!!", { url, method }),
    ).toThrow(/not valid base64/);
  });

  it("rejects the wrong event kind", () => {
    const event = signEvent({
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [
        ["u", url],
        ["method", method],
      ],
    });
    expect(() =>
      verifyNip98Auth(`Nostr ${base64Event(event)}`, { url, method }),
    ).toThrow(/kind must be 27235/);
  });

  it("rejects an expired event", () => {
    const event = signEvent({
      pubkey,
      created_at: Math.floor(Date.now() / 1000) - 120,
      tags: [
        ["u", url],
        ["method", method],
      ],
    });
    expect(() =>
      verifyNip98Auth(`Nostr ${base64Event(event)}`, { url, method }),
    ).toThrow(/expired/);
  });

  it("rejects an event bound to a different URL", () => {
    const event = signEvent({
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", "https://evil.example/target"],
        ["method", method],
      ],
    });
    expect(() =>
      verifyNip98Auth(`Nostr ${base64Event(event)}`, { url, method }),
    ).toThrow(/not bound to this request URL/);
  });

  it("rejects an event bound to a different method", () => {
    const event = signEvent({
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", "GET"],
      ],
    });
    expect(() =>
      verifyNip98Auth(`Nostr ${base64Event(event)}`, { url, method }),
    ).toThrow(/not bound to this HTTP method/);
  });

  it("rejects a forged signature", () => {
    const event = signEvent({
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", method],
      ],
    });
    const forged = { ...event, sig: event.sig.slice(0, 127) + "0" };
    expect(() =>
      verifyNip98Auth(`Nostr ${base64Event(forged)}`, { url, method }),
    ).toThrow(/signature/);
  });

  it("rejects a signature from a different key", () => {
    const otherKey = schnorr.utils.randomSecretKey();
    const otherPubkey = bytesToHex(schnorr.getPublicKey(otherKey));
    const event = signEvent({
      pubkey: otherPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", method],
      ],
    });
    expect(() =>
      verifyNip98Auth(`Nostr ${base64Event(event)}`, { url, method }),
    ).toThrow(/signature/);
  });

  it("hashes a payload body for the payload tag", () => {
    const tag = sha256PayloadTag("hello world");
    expect(tag).toHaveLength(64);
    expect(tag).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("accepts a valid payload-bound event when the body matches", () => {
    const body = '{"message":"hi"}';
    const event = signEvent({
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", method],
        ["payload", sha256PayloadTag(body)],
      ],
    });
    expect(
      verifyNip98Auth(`Nostr ${base64Event(event)}`, { url, method, body }),
    ).toBe(pubkey);
  });

  it("rejects a payload-bound event when the body differs", () => {
    const event = signEvent({
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", method],
        ["payload", sha256PayloadTag('{"message":"real"}')],
      ],
    });
    expect(() =>
      verifyNip98Auth(`Nostr ${base64Event(event)}`, {
        url,
        method,
        body: '{"message":"tampered"}',
      }),
    ).toThrow(/does not match the Nostr payload hash/);
  });

  it("rejects a payload-bound event when the body was never checked", () => {
    const event = signEvent({
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", method],
        ["payload", sha256PayloadTag('{"message":"hi"}')],
      ],
    });
    expect(() =>
      verifyNip98Auth(`Nostr ${base64Event(event)}`, { url, method }),
    ).toThrow(/body was not checked/);
  });
});
