import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  createWorkspaceCommandSchema,
  provisionWorkspaceCommandSchema,
  userIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import worker from "../src/index";
import { computeNostrEventId, sha256PayloadTag } from "../src/nip98";
import { createManagedWorkspace } from "../src/workspace-authority";
import { relayTestEnv } from "./helpers";

// A fixed 32-byte secret key so the signed identity is deterministic.
const secretKey = schnorr.utils.randomSecretKey();
const pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
const ownerIdentity = {
  kind: "user" as const,
  userId: userIdSchema.parse(pubkey),
  pubkey,
};

// A minimal 1x1 transparent PNG.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("attachment upload and read", () => {
  it("uploads a png and requires authenticated channel access to read it", async () => {
    const { workspaceId } = await setup();

    const upload = await worker.fetch(
      signedRequest(
        `https://relay.test/v1/workspaces/${workspaceId}/conversations/general/attachments`,
        "POST",
        JSON.stringify({
          fileName: "pixel.png",
          contentType: "image/png",
          base64: PNG_1X1.toString("base64"),
        }),
      ),
      relayEnv(),
      createExecutionContext(),
    );
    expect(upload.status).toBe(201);
    const result = (await upload.json()) as {
      url: string;
      key: string;
    };
    expect(result.url).toMatch(
      new RegExp(
        `^https://relay\\.test/v1/workspaces/${workspaceId}/conversations/general/attachments/`,
        "u",
      ),
    );
    expect(result.key).toMatch(/\.png$/u);

    const unauthenticated = await worker.fetch(
      new Request(result.url),
      relayEnv(),
      createExecutionContext(),
    );
    expect(unauthenticated.status).toBe(401);

    const download = await worker.fetch(
      signedRequest(result.url, "GET"),
      relayEnv(),
      createExecutionContext(),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.equals(PNG_1X1)).toBe(true);
  });

  it("rejects an oversized attachment before storing anything", async () => {
    const { workspaceId } = await setup();
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
    oversized.fill(0x42);

    const upload = await worker.fetch(
      signedRequest(
        `https://relay.test/v1/workspaces/${workspaceId}/conversations/general/attachments`,
        "POST",
        JSON.stringify({
          fileName: "big.png",
          contentType: "image/png",
          base64: oversized.toString("base64"),
        }),
      ),
      relayEnv(),
      createExecutionContext(),
    );
    expect(upload.status).toBe(413);
    expect(await upload.json()).toMatchObject({
      error: { code: "attachment_too_large" },
    });
  });

  it("rejects a non-image content type", async () => {
    const { workspaceId } = await setup();
    const upload = await worker.fetch(
      signedRequest(
        `https://relay.test/v1/workspaces/${workspaceId}/conversations/general/attachments`,
        "POST",
        JSON.stringify({
          fileName: "note.pdf",
          contentType: "application/pdf",
          base64: Buffer.from("not-an-image").toString("base64"),
        }),
      ),
      relayEnv(),
      createExecutionContext(),
    );
    expect(upload.status).toBe(415);
  });

  it("rejects bytes that do not match the declared image type", async () => {
    const { workspaceId } = await setup();
    const upload = await worker.fetch(
      signedRequest(
        `https://relay.test/v1/workspaces/${workspaceId}/conversations/general/attachments`,
        "POST",
        JSON.stringify({
          fileName: "fake.png",
          contentType: "image/png",
          base64: Buffer.from("not-a-png").toString("base64"),
        }),
      ),
      relayEnv(),
      createExecutionContext(),
    );
    expect(upload.status).toBe(415);
    expect(await upload.json()).toMatchObject({
      error: { code: "attachment_content_mismatch" },
    });
  });
});
async function setup() {
  const relay = relayTestEnv();
  const command = createWorkspaceCommandSchema.parse({
    commandId: crypto.randomUUID(),
    name: "Attachment test",
    website: "https://heychief.sh",
    runtime: "phone" as const,
    inferenceProvider: "openCodeGo",
    inferenceModel: "deepseek-v4-flash",
    selectedApps: [],
  });
  const created = await createManagedWorkspace(
    relay,
    ownerIdentity,
    provisionWorkspaceCommandSchema.parse({
      workspace: command,
      secrets: { opencode: "test-opencode-key" },
    }),
  );
  const snapshot = workspaceSnapshotSchema.parse(await created.json());
  return { workspaceId: snapshot.id };
}

function signedRequest(url: string, method: string, body?: string) {
  const tags: string[][] = [
    ["u", url],
    ["method", method],
  ];
  if (body !== undefined) tags.push(["payload", sha256PayloadTag(body)]);
  const event = {
    pubkey,
    content: "",
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
  };
  const id = computeNostrEventId(event);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secretKey));
  const full = { ...event, id, sig };
  const authorization = `Nostr ${Buffer.from(JSON.stringify(full), "utf8").toString("base64")}`;
  const headers = { authorization, "content-type": "application/json" };
  return new Request(url, { method, headers, body });
}

function relayEnv(): Parameters<typeof worker.fetch>[1] {
  return relayTestEnv();
}
