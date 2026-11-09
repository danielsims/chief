import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

import { userIdSchema, workspaceSnapshotSchema } from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";
import { PluginAgentAccessService } from "../src/mcp/plugin-agent-access";
import { mcpConnectionsUpsertConnection } from "../src/queries/mcp-connections/upsert-connection";
import { WorkspaceChannelStore } from "../src/workspace-channel-store";
import { channelRpc, setupChannelTest } from "./channel-test-helpers";
import { hexKey } from "./helpers";

it("members manage their own agents, never someone else's, including cloud agents", async () => {
  const ctx = await setupChannelTest();
  const other = {
    ...ctx.principal,
    userId: userIdSchema.parse("other-plugin-owner"),
    pubkey: hexKey("other-plugin-owner"),
    role: "member" as const,
  };
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const otherConfig = await runInDurableObject(
    stub,
    async (_instance, state) => {
      const store = new WorkspaceChannelStore(state.storage, ctx.env);
      const workspace = store.requireWorkspace(ctx.workspaceId);
      if (!workspace.snapshot_json)
        throw new Error("Workspace fixture requires a snapshot");
      const snapshot = workspaceSnapshotSchema.parse(
        JSON.parse(workspace.snapshot_json),
      );
      const chief = snapshot.agents[0];
      if (!chief) throw new Error("Chief fixture is required");
      snapshot.agents.push({
        ...chief,
        id: "other",
        name: "Other",
        ownerUserId: other.userId,
        subagents: [
          {
            id: "other-child",
            name: "Other child",
            role: "Specialist",
            description: "",
            instructions: "",
            capabilities: [],
          },
        ],
      });
      state.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify(snapshot),
      );
      state.storage.sql.exec(
        "INSERT INTO members (principal_kind, principal_id, role, created_at) VALUES ('user', ?, 'member', ?)",
        other.userId,
        new Date().toISOString(),
      );
      for (const id of ["supabase", "notion"])
        mcpConnectionsUpsertConnection(state.storage, {
          id,
          updatedAt: 1,
          documentJson: JSON.stringify({
            id,
            name: id,
            url: "https://mcp.example.com/mcp",
            auth: { kind: "none" },
            status: "connected",
            tools: [],
            createdAt: 1,
            updatedAt: 1,
          }),
        });
      const access = new PluginAgentAccessService(
        state.storage,
        ctx.env,
        ctx.workspaceId,
      );
      expect(
        access
          .list(other, "supabase")
          .agents.find((agent) => agent.id === "other")?.canEdit,
      ).toBe(true);
      expect(
        access
          .list(other, "supabase")
          .agents.find((agent) => agent.id === "chief")?.canEdit,
      ).toBe(false);
      expect(() =>
        access.update(other, "supabase", ["other", "chief"], true),
      ).toThrow("own agents");
      expect(store.agentConfiguration("other").integrations).toEqual([]);
      access.update(other, "supabase", ["other-child"], true);
      expect(store.agentConfiguration("other-child").integrations).toEqual([
        "supabase",
      ]);
      expect(store.agentConfiguration("other").integrations).toEqual([]);
      access.update(other, "notion", ["other"], true);
      expect(store.agentConfiguration("other").integrations).toEqual([
        "notion",
      ]);
      expect(store.agentConfiguration("other-child").integrations).toEqual([
        "supabase",
      ]);
      expect(() =>
        access.update(ctx.principal, "supabase", ["other"], true),
      ).toThrow("own agents");
      access.update(other, "supabase", ["other", "other-child"], true);
      access.update(other, "supabase", ["other", "other-child"], false);
      expect(store.agentConfiguration("other").integrations).toEqual([
        "notion",
      ]);
      expect(store.agentConfiguration("other-child").integrations).toEqual([]);
      expect(store.agentConfiguration("other").deploymentTarget).toBe("cloud");
      return store.agentConfiguration("other");
    },
  );
  // Broader configuration writes cannot bypass the plugin ownership boundary.
  const result = await channelRpc(ctx, ctx.principal, "agent-config-set", {
    agentId: "other",
    config: { ...otherConfig, integrations: ["supabase"] },
  });
  expect(result.status).toBe(403);
  const accessRpc = (
    operation: string,
    body?: { agentIds: string[]; enabled: boolean },
  ) =>
    stub.fetch(
      withTrustedContext(
        new Request("https://workspace.internal/plugins", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": operation,
            "x-chief-plugin-id": "supabase",
          },
          body: JSON.stringify(body ?? {}),
        }),
        {
          principal: other,
          workspaceId: ctx.workspaceId,
          requestId: crypto.randomUUID(),
        },
      ),
    );
  expect((await accessRpc("mcp-access-get")).status).toBe(200);
  expect(
    (
      await accessRpc("mcp-access", {
        agentIds: ["other-child"],
        enabled: true,
      })
    ).status,
  ).toBe(200);
  expect(
    (await accessRpc("mcp-access", { agentIds: ["chief"], enabled: true }))
      .status,
  ).toBe(403);
});
