import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";
import { ensureChiefOrganization } from "@chief/auth/d1-organizations";
import {
  createWorkspaceCommandSchema,
  ownedAgentConnectCodePayloadSchema,
  ownedAgentConnectResultSchema,
  ownedAgentCredentialSchema,
  ownedAgentDecisionResultSchema,
  ownedAgentListSchema,
  ownedAgentRequestListSchema,
  ownedAgentTokenResultSchema,
  provisionWorkspaceCommandSchema,
  userIdSchema,
  welcomeChannelId,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { HttpError } from "../src/http";
import worker from "../src/index";
import { computeNostrEventId, sha256PayloadTag } from "../src/nip98";
import { OwnedAgentService } from "../src/owned-agent-service";
import { ownedAgentRequestsFind } from "../src/queries/owned-agents/connect";
import { createManagedWorkspace } from "../src/workspace-authority";
import { ensureWelcomeChannel } from "../src/workspace-welcome";
import { relayTestEnv } from "./helpers";

function signingKey() {
  return schnorr.utils.randomSecretKey();
}
function publicKey(secret: Uint8Array) {
  return bytesToHex(schnorr.getPublicKey(secret));
}
function request(
  secret: Uint8Array,
  url: string,
  method = "GET",
  body?: JsonObject,
  extra: Record<string, string> = {},
) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  const tags = [
    ["u", url],
    ["method", method],
    ["request", crypto.randomUUID()],
  ];
  if (encoded !== undefined) tags.push(["payload", sha256PayloadTag(encoded)]);
  const unsigned = {
    pubkey: publicKey(secret),
    content: "",
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
  };
  const id = computeNostrEventId(unsigned);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secret));
  return new Request(url, {
    method,
    headers: {
      authorization: `Nostr ${btoa(JSON.stringify({ ...unsigned, id, sig }))}`,
      ...(encoded === undefined
        ? undefined
        : { "content-type": "application/json" }),
      ...extra,
    },
    body: encoded,
  });
}
async function setup(purpose: "personal" | "company" = "personal") {
  const env = {
    ...relayTestEnv(),
    BETTER_AUTH_SECRET: z
      .object({ BETTER_AUTH_SECRET: z.string() })
      .parse(workerEnv).BETTER_AUTH_SECRET,
  };
  const secret = signingKey();
  const pubkey = publicKey(secret);
  const now = Date.now();
  await env.AUTH_DB.prepare(
    "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)",
  )
    .bind(pubkey, "Test owner", `${pubkey}@example.test`, now, now)
    .run();
  const command = createWorkspaceCommandSchema.parse({
    commandId: crypto.randomUUID(),
    name: "Test workspace",
    slug: "test-workspace",
    purpose,
    companyName: purpose === "company" ? "Test Company" : undefined,
    website: "",
    runtime: "desktop",
    localProvider: "codex",
    agentRuntime: "relay-cell",
    inferenceProvider: "onDevice",
    inferenceModel: "auto",
    selectedApps: [],
    selectedAgentIds:
      purpose === "personal"
        ? ["researcher", "planner"]
        : ["brand", "engineer"],
  });
  const response = await createManagedWorkspace(
    env,
    { kind: "user", userId: userIdSchema.parse(pubkey), pubkey },
    provisionWorkspaceCommandSchema.parse({ workspace: command, secrets: {} }),
  );
  expect(response.status).toBe(200);
  const snapshot = workspaceSnapshotSchema.parse(await response.json());
  const base = `https://relay.test/v1/workspaces/${snapshot.id}`;
  const call = (
    path: string,
    method = "GET",
    body?: JsonObject,
    key = secret,
    headers: Record<string, string> = {},
  ) =>
    worker.fetch(
      request(
        key,
        path.startsWith("/v1/")
          ? `https://relay.test${path}`
          : `${base}${path}`,
        method,
        body,
        headers,
      ),
      env,
      createExecutionContext(),
    );
  return { env, secret, pubkey, snapshot, call };
}

describe("approval-bound onboarding", () => {
  it("does not approve a request denied while the owner lookup was in flight", async () => {
    const ctx = await setup();
    const response = await ctx.call("/owned-agents/codes", "POST");
    const invite = z
      .object({ connectCode: z.string() })
      .parse(await response.json());
    const payload = ownedAgentConnectCodePayloadSchema.parse(
      JSON.parse(
        atob(invite.connectCode.replace(/-/gu, "+").replace(/_/gu, "/")),
      ),
    );
    const agent = signingKey();
    expect(
      (
        await ctx.call(
          "/agent-connect/connect",
          "POST",
          {
            code: payload.code,
            name: "claude",
            provider: "claude",
            publicKey: publicKey(agent),
          },
          agent,
        )
      ).status,
    ).toBe(201);
    const pending = ownedAgentRequestListSchema.parse(
      await (await ctx.call("/owned-agents/requests")).json(),
    ).requests[0];
    if (!pending) throw new Error("Expected the pending request.");
    const principal = {
      kind: "user" as const,
      userId: userIdSchema.parse(ctx.pubkey),
      pubkey: ctx.pubkey,
      workspaceId: ctx.snapshot.id,
      role: "owner" as const,
    };
    const stub = ctx.env.WORKSPACES.get(
      ctx.env.WORKSPACES.idFromName(ctx.snapshot.id),
    );
    const status = await runInDurableObject(stub, async (_instance, state) => {
      const service = new OwnedAgentService(state.storage, ctx.env);
      service.owners = async () => {
        await service.decide(principal, pending.id, false);
        return new Map([
          [ctx.pubkey, { username: "race-owner", name: "Test owner" }],
        ]);
      };
      try {
        await service.decide(principal, pending.id, true);
        return "incorrectly-approved";
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
      }
      return ownedAgentRequestsFind(state.storage, pending.id)?.status;
    });
    expect(status).toBe("denied");
  });

  it("requires unique account usernames and persists the chosen team and a retry-safe personal welcome", async () => {
    const ctx = await setup();
    expect(ctx.snapshot).toMatchObject({
      slug: "test-workspace",
      purpose: "personal",
      setupComplete: false,
    });
    expect(ctx.snapshot.agents[0]?.subagents.map((a) => a.id)).toEqual([
      "researcher",
      "planner",
    ]);
    expect(
      (await ctx.call("/v1/me/username", "POST", { username: "Chief" })).status,
    ).toBe(400);
    expect(
      (await ctx.call("/v1/me/username", "POST", { username: "Profile-Owner" }))
        .status,
    ).toBe(200);
    await ensureChiefOrganization(ctx.env.AUTH_DB, {
      workspaceId: ctx.snapshot.id,
      ownerUserId: ctx.pubkey,
      name: ctx.snapshot.name,
      website: "",
      purpose: "personal",
      slug: "test-workspace",
    });
    await ensureChiefOrganization(ctx.env.AUTH_DB, {
      workspaceId: ctx.snapshot.id,
      ownerUserId: ctx.pubkey,
      name: ctx.snapshot.name,
      website: "updated.example.test",
    });
    const organization = await ctx.env.AUTH_DB.prepare(
      "SELECT metadata FROM organization WHERE id = ?",
    )
      .bind(ctx.snapshot.id)
      .first<{ metadata: string }>();
    expect(JSON.parse(organization?.metadata ?? "null")).toMatchObject({
      purpose: "personal",
      workspaceSlug: "test-workspace",
      website: "updated.example.test",
    });
    const other = await setup();
    expect(
      (
        await other.call("/v1/me/username", "POST", {
          username: "profile-owner",
        })
      ).status,
    ).toBe(409);
    expect((await ctx.call("/setup/welcome", "POST", {})).status).toBe(409);
    const finished = await ctx.call("/setup/complete", "POST", {
      selectedApps: ["github.com"],
    });
    expect(finished.status, await finished.clone().text()).toBe(200);
    expect(await finished.json()).toMatchObject({
      setupComplete: true,
      onboardingComplete: true,
      selectedApps: ["github.com"],
    });
    expect(
      (
        await ctx.call("/setup/complete", "POST", {
          selectedApps: ["github.com"],
        })
      ).status,
    ).toBe(200);
    const beforeWelcome = await ctx.call(
      `/conversations/${welcomeChannelId(ctx.pubkey)}/messages`,
    );
    expect(beforeWelcome.ok).toBe(false);
    const welcomeStartedAt = Date.now();
    const starts = await Promise.all([
      ctx.call("/setup/welcome", "POST", {}),
      ctx.call("/setup/welcome", "POST", {}),
    ]);
    expect(starts.map((response) => response.status)).toEqual([200, 200]);
    expect((await ctx.call("/setup/welcome", "POST", {})).status).toBe(200);
    const messages = await ctx.call(
      `/conversations/${welcomeChannelId(ctx.pubkey)}/messages`,
    );
    expect(messages.status).toBe(200);
    const welcomePage = (await messages.json()) as {
      messages: {
        createdAt: string;
        components: { kind: string; payload: { userIds?: string } }[];
      }[];
    };
    expect(welcomePage.messages.length).toBeGreaterThan(0);
    expect(welcomePage.messages[0]?.components[0]).toMatchObject({
      kind: "channel-action",
      payload: { userIds: ctx.pubkey },
    });
    expect(
      welcomePage.messages
        .flatMap((message) => message.components)
        .some(
          (component) =>
            component.kind === "channel-action" &&
            component.payload.userIds === ctx.pubkey,
        ),
    ).toBe(true);
    for (const message of welcomePage.messages) {
      expect(Date.parse(message.createdAt)).toBeGreaterThanOrEqual(
        welcomeStartedAt,
      );
    }
    const content = JSON.stringify(welcomePage);
    expect(content).toContain("personal chief of staff");
    expect(content).not.toContain("researches your business");
    expect(content.match(/Welcome to Test workspace/gu)).toHaveLength(1);
    expect(
      (await ctx.call("/setup", "GET", undefined, signingKey())).status,
    ).toBe(403);
  });
  it("leaves an existing Welcome channel alone when upgrading from the earlier setup flow", async () => {
    const ctx = await setup();
    expect((await ctx.call("/setup/complete", "POST", {})).status).toBe(200);
    const stub = ctx.env.WORKSPACES.get(
      ctx.env.WORKSPACES.idFromName(ctx.snapshot.id),
    );
    await runInDurableObject(stub, (_instance, state) => {
      ensureWelcomeChannel(state.storage, {
        workspaceId: ctx.snapshot.id,
        userId: ctx.pubkey,
        now: new Date().toISOString(),
      });
    });
    expect((await ctx.call("/setup/welcome", "POST", {})).status).toBe(200);
    const messages = await ctx.call(
      `/conversations/${welcomeChannelId(ctx.pubkey)}/messages`,
    );
    expect(await messages.json()).toMatchObject({ messages: [] });
  });
  it("keeps company selections and does not silently restore the old mandatory specialists", async () => {
    const ctx = await setup("company");
    expect(ctx.snapshot.agents[0]?.subagents.map((a) => a.id)).toEqual([
      "brand",
      "engineer",
    ]);
    const finished = await ctx.call("/setup/complete", "POST", {});
    expect(finished.status, await finished.clone().text()).toBe(200);
    expect((await ctx.call("/setup/welcome", "POST", {})).status).toBe(200);
    const messages = await ctx.call(
      `/conversations/${welcomeChannelId(ctx.pubkey)}/messages`,
    );
    const text = await messages.text();
    expect(text).toContain("team's chief of staff");
    expect(text).toContain("Test Company");
    expect(text).not.toContain("buying signals");
  });
  it("requests, approves, signs, scopes, renames and revokes a real external agent", async () => {
    const ctx = await setup();
    const agent = signingKey();
    const agentPubkey = publicKey(agent);
    const codeResponse = await ctx.call("/owned-agents/codes", "POST");
    expect(codeResponse.status).toBe(201);
    const codeBody = (await codeResponse.json()) as { connectCode: string };
    const code = ownedAgentConnectCodePayloadSchema.parse(
      JSON.parse(
        atob(codeBody.connectCode.replace(/-/gu, "+").replace(/_/gu, "/")),
      ),
    );
    const connectBody = {
      code: code.code,
      name: "chatgpt",
      provider: "chatgpt",
      publicKey: agentPubkey,
    };
    expect(
      (
        await ctx.call(
          "/agent-connect/connect",
          "POST",
          { ...connectBody, publicKey: publicKey(signingKey()) },
          agent,
        )
      ).status,
    ).toBe(401);
    const connected = await ctx.call(
      "/agent-connect/connect",
      "POST",
      connectBody,
      agent,
    );
    expect(connected.status, await connected.clone().text()).toBe(201);
    const pending = ownedAgentConnectResultSchema.parse(await connected.json());
    const requests = ownedAgentRequestListSchema.parse(
      await (await ctx.call("/owned-agents/requests")).json(),
    );
    const firstRequest = requests.requests[0];
    if (!firstRequest)
      throw new Error("The agent request must be visible to its owner.");
    const id = firstRequest.id;
    expect(requests.requests[0]?.userCode).toBe(pending.user_code);
    expect(
      (await ctx.call(`/owned-agents/requests/${id}/approve`, "POST")).status,
    ).toBe(409);
    expect(
      (
        await ctx.call(
          `/owned-agents/requests/${id}/approve`,
          "POST",
          undefined,
          signingKey(),
        )
      ).status,
    ).toBe(403);
    expect(
      (await ctx.call("/v1/me/username", "POST", { username: "connect-owner" }))
        .status,
    ).toBe(200);
    const approval = await ctx.call(
      `/owned-agents/requests/${id}/approve`,
      "POST",
    );
    expect(approval.status, await approval.clone().text()).toBe(200);
    const approved = ownedAgentDecisionResultSchema.parse(
      await approval.json(),
    );
    expect(approved.agent?.handle).toBe("connect-owner:chatgpt");
    expect(approved.agent?.channels.map((c) => c.id)).toEqual(["general"]);
    const tokenResponse = await ctx.call(
      "/agent-connect/token",
      "POST",
      { device_code: pending.device_code },
      agent,
    );
    expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
    const token = ownedAgentTokenResultSchema.parse(await tokenResponse.json());
    const identityHeaders = { "x-chief-owned-agent-id": token.agentId };
    expect(
      (
        await ctx.call(
          "/agent-connect/self",
          "GET",
          undefined,
          agent,
          identityHeaders,
        )
      ).status,
    ).toBe(401);
    const challenge = (await (
      await ctx.call(
        "/agent-connect/challenge",
        "POST",
        undefined,
        agent,
        identityHeaders,
      )
    ).json()) as { challenge: string };
    const credentialResponse = await ctx.call(
      "/agent-connect/credential",
      "POST",
      { challenge: challenge.challenge },
      agent,
      identityHeaders,
    );
    expect(credentialResponse.status).toBe(201);
    const credential = ownedAgentCredentialSchema.parse(
      await credentialResponse.json(),
    );
    const headers = {
      ...identityHeaders,
      "x-chief-agent-credential": credential.credential,
    };
    expect(
      (
        await ctx.call(
          "/agent-connect/self",
          "GET",
          undefined,
          signingKey(),
          headers,
        )
      ).status,
    ).toBe(401);
    const self = await ctx.call(
      "/agent-connect/self",
      "GET",
      undefined,
      agent,
      headers,
    );
    expect(self.status, await self.clone().text()).toBe(200);
    expect(
      (
        await ctx.call(
          "/agent-connect/messages",
          "POST",
          { channelId: "mission-control", body: "Not allowed" },
          agent,
          headers,
        )
      ).status,
    ).toBe(403);
    const posted = await ctx.call(
      "/agent-connect/messages",
      "POST",
      {
        channelId: "general",
        body: "Connected after approval",
        idempotencyKey: crypto.randomUUID(),
      },
      agent,
      headers,
    );
    expect(posted.status, await posted.clone().text()).toBe(201);
    expect(
      (await ctx.call("/data/brand-profile", "GET", undefined, agent, headers))
        .status,
    ).toBe(403);
    expect(
      (await ctx.call("/v1/me/username", "POST", { username: "renamed-owner" }))
        .status,
    ).toBe(200);
    const roster = ownedAgentListSchema.parse(
      await (await ctx.call("/owned-agents")).json(),
    );
    expect(roster.agents[0]?.handle).toBe("renamed-owner:chatgpt");
    expect(
      (await ctx.call(`/owned-agents/${token.agentId}/revoke`, "POST")).status,
    ).toBe(200);
    expect(
      (await ctx.call("/agent-connect/self", "GET", undefined, agent, headers))
        .status,
    ).toBe(401);
    expect((await ctx.call("/guest/messages")).status).toBe(404);
  });
});
