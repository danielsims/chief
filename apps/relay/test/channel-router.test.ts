import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  agentRuntimeDescriptorSchema,
  appendMessageCommandSchema,
  createWorkspaceCommandSchema,
  machineViewerTicketSchema,
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
  it("issues browser viewer tickets only for signed requests to visible sessions", async () => {
    const workspaceId = await setupWorkspace();
    const relay = relayEnv();
    const stub = relay.WORKSPACES.get(relay.WORKSPACES.idFromName(workspaceId));
    const machineId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const hiddenSessionId = crypto.randomUUID();
    const hostname = `m-${machineId}.example.test`;
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put(`machine:${machineId}`, {
        machineId,
        ownerUserId: owner.userId,
        name: "Test machine",
        keyHash: "unused-key-hash",
        createdAt: Date.now(),
        stream: {
          hostname,
          tunnelId: "test-tunnel",
          dnsRecordId: "test-record",
          secret: "test-stream-secret",
        },
      });
      await state.storage.put(`machine.browser:chief:${sessionId}`, {
        machineId,
        conversationId: "general",
        at: Date.now(),
      });
      await state.storage.put(`machine.browser:chief:${hiddenSessionId}`, {
        machineId,
        conversationId: "unavailable-conversation",
        at: Date.now(),
      });
    });
    const url = `https://relay.test/v1/workspaces/${workspaceId}/machines/viewer-tickets`;
    const body = JSON.stringify({ agentId: "chief", sessionId });
    const fetch = (request: Request) =>
      worker.fetch(request, relay, createExecutionContext());
    const visible = await fetch(signedRequest(url, "POST", body));
    expect(visible.status, await visible.clone().text()).toBe(200);
    expect(machineViewerTicketSchema.parse(await visible.json())).toEqual({
      url: `wss://${hostname}/stream/${sessionId}`,
      protocols: ["chief-stream.v1", expect.stringMatching(/^chief-ticket\./u)],
    });

    const hidden = await fetch(
      signedRequest(
        url,
        "POST",
        JSON.stringify({ agentId: "chief", sessionId: hiddenSessionId }),
      ),
    );
    expect(hidden.status).toBe(404);

    const unsigned = await fetch(new Request(url, { method: "POST", body }));
    expect(unsigned.status).toBe(401);

    const pairedUrl = `https://relay.test/v1/workspaces/${workspaceId}/machines/paired/${machineId}`;
    const disabled = await fetch(
      signedRequest(pairedUrl, "PATCH", JSON.stringify({ enabled: false })),
    );
    expect(disabled.status, await disabled.clone().text()).toBe(200);
    expect(await disabled.json()).toEqual({ ok: true, enabled: false });
    const listed = await fetch(
      signedRequest(
        `https://relay.test/v1/workspaces/${workspaceId}/machines/paired`,
        "GET",
      ),
    );
    expect(await listed.json()).toMatchObject({
      machines: [expect.objectContaining({ id: machineId, enabled: false })],
    });

    const otherMachine = crypto.randomUUID();
    const notOwned = await fetch(
      signedRequest(
        `https://relay.test/v1/workspaces/${workspaceId}/machines/paired/${otherMachine}`,
        "PATCH",
        JSON.stringify({ enabled: false }),
      ),
    );
    expect(notOwned.status).toBe(404);
  });

  it("no longer serves channel guest invites", async () => {
    const workspaceId = await setupWorkspace();
    const response = await worker.fetch(
      signedRequest(
        `https://relay.test/v1/workspaces/${workspaceId}/channels/general/guests/invite`,
        "POST",
      ),
      relayEnv(),
      createExecutionContext(),
    );
    expect(response.status).toBe(404);
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

    expect(first.status, await first.clone().text()).toBe(202);
    expect(await first.json()).toMatchObject({
      duplicate: false,
      job: {
        agentId: "chief",
        kind: "agent.invoke",
        payload: {
          conversationId: expect.stringMatching(/^dm-/u),
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
  const id = workspaceSnapshotSchema.parse(await created.json()).id;
  const finished = await worker.fetch(
    signedRequest(
      `https://relay.test/v1/workspaces/${id}/setup/complete`,
      "POST",
      "{}",
    ),
    relay,
    createExecutionContext(),
  );
  expect(finished.status, await finished.clone().text()).toBe(200);
  return id;
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
