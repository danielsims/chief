import { afterEach, expect, it, vi } from "vitest";

import type { AgentConfig, Principal } from "@chief/relay-contracts";
import { agentIdSchema, defaultAgentConfig } from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";
import {
  channelRpc,
  registerTestAgent,
  setupChannelTest,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

type Context = Awaited<ReturnType<typeof setupChannelTest>>;

function readSecret(ctx: Context, principal: Principal, name?: string) {
  const target = new URL("https://workspace.internal");
  if (name) target.searchParams.set("name", name);
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const request = withTrustedContext(
    new Request(target, {
      headers: {
        "x-chief-internal-operation": name ? "secret-get" : "secret-list",
      },
    }),
    {
      principal,
      workspaceId: ctx.workspaceId,
      requestId: crypto.randomUUID(),
    },
  );
  return stub.fetch(request);
}

async function configure(ctx: Context, config: AgentConfig) {
  expect(
    (
      await channelRpc(ctx, ctx.principal, "agent-config-set", {
        agentId: "engineer",
        config,
      })
    ).status,
  ).toBe(200);
}

it("grants only the enabled agent's configured inference secret and keeps infrastructure credentials private", async () => {
  const ctx = await setupChannelTest();
  const pubkey = hexKey("secret-test-engineer");
  expect((await registerTestAgent(ctx, "engineer", pubkey)).status).toBe(200);
  const agent: Principal = {
    kind: "agent",
    agentId: agentIdSchema.parse("engineer"),
    pubkey,
    role: "member",
    workspaceId: ctx.workspaceId,
  };
  const config = {
    ...defaultAgentConfig,
    deploymentTarget: "phone" as const,
    toolPermissions: [],
  };
  await configure(ctx, config);
  expect(await (await readSecret(ctx, agent, "opencode")).json()).toMatchObject(
    { value: "test-opencode-key" },
  );
  for (const name of [
    "vercel-deployment",
    "external-agent.chief.channel",
    "external-agent.chief.delivery-signing.test",
    "unrelated-api",
  ]) {
    expect(
      (
        await channelRpc(ctx, ctx.principal, "secret-set", {
          name,
          value: "private-owner-token",
        })
      ).status,
    ).toBe(200);
    expect((await readSecret(ctx, agent, name)).status).toBe(403);
  }
  expect(await (await readSecret(ctx, agent)).json()).toMatchObject({
    secrets: [{ name: "opencode" }],
  });
  await configure(ctx, {
    ...config,
    inference: {
      provider: "opencode",
      model: "test-model",
      secretRef: "vercel-deployment",
    },
  });
  expect((await readSecret(ctx, agent, "vercel-deployment")).status).toBe(403);
  await channelRpc(ctx, ctx.principal, "secret-set", {
    name: "vercel-ai-gateway",
    value: "private-owner-token",
  });
  await configure(ctx, {
    ...config,
    inference: {
      provider: "vercel-ai-gateway",
      model: "test-model",
      secretRef: "vercel-ai-gateway",
    },
  });
  expect((await readSecret(ctx, agent, "vercel-ai-gateway")).status).toBe(403);
  await configure(ctx, { ...config, enabled: false });
  expect((await readSecret(ctx, agent, "opencode")).status).toBe(403);
  expect((await readSecret(ctx, agent)).status).toBe(403);
});

it("fails Vercel setup without storing an owner token as an inference key when gateway key creation fails", async () => {
  const ctx = await setupChannelTest();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      return new URL(request.url).pathname === "/v2/teams"
        ? Response.json({
            teams: [{ id: "team-test", name: "Test", slug: "test" }],
          })
        : Response.json(
            { error: { message: "Key creation denied" } },
            { status: 403 },
          );
    }),
  );
  const failed = await channelRpc(ctx, ctx.principal, "vercel-connect", {
    token: "test-vercel-owner-token",
  });
  expect(failed.status).toBe(400);
  expect(await failed.json()).toMatchObject({
    error: { code: "vercel_gateway_key_failed" },
  });
  expect(await (await readSecret(ctx, ctx.principal)).json()).toMatchObject({
    secrets: [{ name: "opencode" }],
  });
});
