import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createWorkspaceCommandSchema,
  userIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import worker from "../src/index";
import { computeNostrEventId, sha256PayloadTag } from "../src/nip98";
import { createManagedWorkspace } from "../src/workspace-authority";
import { channelEnvelope } from "./channel-test-helpers";

const secretKey = schnorr.utils.randomSecretKey();
const pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
const owner = {
  kind: "user" as const,
  userId: userIdSchema.parse(pubkey),
  pubkey,
};

describe("channel HTTP surface", () => {
  it("creates, lists, gets, and lists members over the router", async () => {
    const workspaceId = await setupWorkspace();
    const request = (path: string, method = "GET", body?: string) =>
      worker.fetch(
        signedRequest(
          `https://relay.test/v1/workspaces/${workspaceId}${path}`,
          method,
          body,
        ),
        relayEnv(),
        createExecutionContext(),
      );

    const create = await request(
      "/channels",
      "POST",
      JSON.stringify(
        channelEnvelope({
          conversationId: "advisory",
          name: "advisory",
          isPrivate: false,
        }),
      ),
    );
    expect(create.status).toBe(201);

    const list = await request("/channels");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      channels: expect.arrayContaining([
        expect.objectContaining({ id: "advisory" }),
      ]),
    });

    const detail = await request("/channels/advisory");
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      channel: { id: "advisory" },
      members: [{ kind: "user", principalId: pubkey, role: "owner" }],
    });

    const members = await request("/channels/advisory/members");
    expect(members.status).toBe(200);
    expect(await members.json()).toMatchObject({
      members: [{ kind: "user", principalId: pubkey, role: "owner" }],
    });

    // Workspace data uses the same authenticated router-to-DO trust boundary.
    // An empty profile is a valid result and must reach the data handler.
    const emptyBrandProfile = await request("/data/brand-profile");
    expect(emptyBrandProfile.status).toBe(204);
  });
});

async function setupWorkspace() {
  const relay = env as unknown as Parameters<typeof createManagedWorkspace>[0];
  const command = createWorkspaceCommandSchema.parse({
    commandId: crypto.randomUUID(),
    name: "Router channel test",
    website: "https://heychief.sh",
    runtime: "phone",
    inferenceProvider: "openCodeGo",
    inferenceModel: "deepseek-v4-flash",
    selectedApps: [],
  });
  const created = await createManagedWorkspace(relay, owner, command);
  return workspaceSnapshotSchema.parse(await created.json()).id;
}

function signedRequest(url: string, method: string, body?: string) {
  const tags: string[][] = [
    ["u", url],
    ["method", method],
  ];
  if (body !== undefined) tags.push(["payload", sha256PayloadTag(body)]);
  const unsigned = {
    pubkey,
    content: "",
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
  };
  const id = computeNostrEventId(unsigned);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secretKey));
  const authorization = `Nostr ${Buffer.from(
    JSON.stringify({ ...unsigned, id, sig }),
    "utf8",
  ).toString("base64")}`;
  const headers: Record<string, string> = { authorization };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, { method, headers, body });
}

function relayEnv(): Parameters<typeof worker.fetch>[1] {
  return env as unknown as Parameters<typeof worker.fetch>[1];
}
