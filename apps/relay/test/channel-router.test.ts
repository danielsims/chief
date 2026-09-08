import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  agentRuntimeDescriptorSchema,
  appendMessageCommandSchema,
  createWorkspaceCommandSchema,
  provisionWorkspaceCommandSchema,
  userIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import worker from "../src/index";
import { computeNostrEventId, sha256PayloadTag } from "../src/nip98";
import { createManagedWorkspace } from "../src/workspace-authority";
import { channelEnvelope } from "./channel-test-helpers";
import { relayTestEnv } from "./helpers";

const secretKey = schnorr.utils.randomSecretKey();
const pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
const owner = {
  kind: "user" as const,
  userId: userIdSchema.parse(pubkey),
  pubkey,
};

describe("channel HTTP surface", () => {
  it("does not forward caller-supplied internal operations or identities", async () => {
    const workspaceId = await setupWorkspace();
    const url = `https://relay.test/v1/workspaces/${workspaceId}/conversations/general/messages`;
    const messageId = crypto.randomUUID();
    const command = appendMessageCommandSchema.parse({
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      commandId: crypto.randomUUID(),
      payload: {
        messageId,
        conversationId: "general",
        body: "Keep this message.",
      },
    });
    const posted = await worker.fetch(
      signedRequest(url, "POST", JSON.stringify(command)),
      relayEnv(),
      createExecutionContext(),
    );
    expect(posted.status).toBe(200);
    const malicious = signedRequest(url, "GET");
    malicious.headers.set("x-chief-internal-operation", "delete-all");
    malicious.headers.set(
      "x-chief-trusted-identity",
      JSON.stringify({ kind: "service", serviceId: "attacker" }),
    );
    malicious.headers.set("x-chief-conversation-id", "other-private-channel");
    const response = await worker.fetch(
      malicious,
      relayEnv(),
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ id: messageId }),
      ]),
    });
    const after = await worker.fetch(
      signedRequest(url, "GET"),
      relayEnv(),
      createExecutionContext(),
    );
    expect(await after.json()).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ id: messageId }),
      ]),
    });
  });
  it("exposes each agent at its workspace-scoped URL", async () => {
    const workspaceId = await setupWorkspace();
    const url = `https://relay.test/v1/workspaces/${workspaceId}/agents/chief`;

    const response = await worker.fetch(
      signedRequest(url, "GET"),
      relayEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(agentRuntimeDescriptorSchema.parse(await response.json())).toEqual({
      workspaceId,
      agentId: "chief",
      address: url,
      deploymentTarget: "phone",
      status: "waiting",
      computer: "local-celld",
    });
  });

  it("accepts idempotent work at the agent's stable URL", async () => {
    const workspaceId = await setupWorkspace();
    const url = `https://relay.test/v1/workspaces/${workspaceId}/agents/chief`;
    const invoke = () =>
      worker.fetch(
        signedRequest(
          url,
          "POST",
          JSON.stringify({
            instruction: "Prepare a concise workspace update.",
            idempotencyKey: "daily-workspace-update",
          }),
        ),
        relayEnv(),
        createExecutionContext(),
      );

    const first = await invoke();
    const duplicate = await invoke();

    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({
      duplicate: false,
      job: {
        agentId: "chief",
        kind: "agent.invoke",
        payload: {
          conversationId: "chief",
          instruction: "Prepare a concise workspace update.",
        },
      },
    });
    expect(await duplicate.json()).toMatchObject({ duplicate: true });
  });

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
  const relay = relayTestEnv();
  const command = createWorkspaceCommandSchema.parse({
    commandId: crypto.randomUUID(),
    name: "Router channel test",
    website: "https://heychief.sh",
    runtime: "phone",
    agentRuntime: "relay-cell",
    inferenceProvider: "openCodeGo",
    inferenceModel: "deepseek-v4-flash",
    selectedApps: [],
  });
  const created = await createManagedWorkspace(
    relay,
    owner,
    provisionWorkspaceCommandSchema.parse({
      workspace: command,
      secrets: { opencode: "test-opencode-key" },
    }),
  );
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
  return relayTestEnv();
}
