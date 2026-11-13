import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

import type { WorkspaceObject } from "../src/workspace-object";
import { McpConnectionService } from "../src/mcp/connection-service";
import { sha256 } from "../src/mcp/oauth-support";
import { mcpConnectionsInsertOAuthRequest } from "../src/queries/mcp-connections/insert-oauth-request";
import { mcpConnectionsUpsertConnection } from "../src/queries/mcp-connections/upsert-connection";
import { WorkspaceChannelStore } from "../src/workspace-channel-store";
import { setupChannelTest } from "./channel-test-helpers";

async function fixture() {
  const ctx = await setupChannelTest();
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  return { ctx, stub };
}

async function seed(
  storage: DurableObjectStorage,
  userId: string,
  start: string,
) {
  const now = Date.now();
  mcpConnectionsUpsertConnection(storage, {
    id: "supabase",
    updatedAt: now,
    documentJson: JSON.stringify({
      id: "supabase",
      name: "Supabase",
      url: "https://mcp.supabase.com/mcp",
      auth: { kind: "oauth" },
      status: "needs_auth",
      tools: [],
      createdAt: now,
      updatedAt: now,
    }),
  });
  mcpConnectionsInsertOAuthRequest(storage, {
    nonce_hash: await sha256(`nonce-${start}`),
    start_hash: await sha256(start),
    connection_id: "supabase",
    user_id: userId,
    authorization_url: "https://supabase.com/oauth/authorize",
    expires_at: now + 60_000,
  });
}

it("browser confirmation never grants agent access", async () => {
  const { ctx, stub } = await fixture();
  await runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
    await seed(state.storage, ctx.principal.userId, "first");
    const service = new McpConnectionService(
      state.storage,
      ctx.env,
      ctx.workspaceId,
    );
    const channels = new WorkspaceChannelStore(state.storage, ctx.env);
    expect(await service.describeStart("first")).not.toHaveProperty("agents");
    await service.confirmStart("first");
    expect(channels.agentConfiguration("chief").integrations).toEqual([]);
    await expect(service.confirmStart("first")).rejects.toThrow("expired");
  });
});

it("rejects a pending sign-in after the initiating admin loses access", async () => {
  const { ctx, stub } = await fixture();
  await runInDurableObject(stub, async (_instance: WorkspaceObject, state) => {
    await seed(state.storage, ctx.principal.userId, "revoked");
    state.storage.sql.exec(
      "UPDATE members SET role = 'member' WHERE principal_kind = 'user' AND principal_id = ?",
      ctx.principal.userId,
    );
    const service = new McpConnectionService(
      state.storage,
      ctx.env,
      ctx.workspaceId,
    );
    await expect(service.describeStart("revoked")).rejects.toThrow(
      "owner or admin",
    );
    await expect(service.confirmStart("revoked")).rejects.toThrow(
      "owner or admin",
    );
    expect(
      new WorkspaceChannelStore(state.storage, ctx.env).agentConfiguration(
        "chief",
      ).integrations,
    ).not.toContain("supabase");
  });
});
