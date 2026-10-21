import { describe, expect, it } from "vitest";

import type { JsonObject } from "@chief/relay-contracts";
import {
  agentIdSchema,
  defaultAgentConfig,
  relayProjectsResultSchema,
} from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";
import {
  channelEnvelope,
  channelRpc,
  registerTestAgent,
  setupChannelTest,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

describe("workspace data", () => {
  it("persists an agent-authored brand profile as shared context and a versioned file", async () => {
    const ctx = await setupChannelTest();
    await channelRpc(
      ctx,
      ctx.principal,
      "channels-create",
      channelEnvelope({ conversationId: "marketing", name: "marketing" }),
    );
    const brandId = agentIdSchema.parse("brand");
    const pubkey = hexKey("workspace-data-brand");
    await registerTestAgent(ctx, brandId, pubkey);
    const brand = {
      kind: "agent" as const,
      agentId: brandId,
      pubkey,
      workspaceId: ctx.workspaceId,
      role: "member" as const,
    };

    const saved = await rpc(ctx, brand, "data-brand-save", {
      markdown: "# Brand profile\n\nEvidence-backed positioning.",
      sourceUrls: ["https://heychief.sh/"],
      conversationId: "marketing",
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      profile: { version: 1, authorAgentId: "brand" },
      file: { id: "brand-profile", path: "brand/profile.md", version: 1 },
    });

    const profile = await rpc(ctx, ctx.principal, "data-brand-get");
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({
      markdown: expect.stringContaining("Evidence-backed"),
      sourceUrls: ["https://heychief.sh/"],
    });

    const files = await rpc(ctx, ctx.principal, "data-files-list");
    expect(await files.json()).toMatchObject({
      files: [expect.objectContaining({ title: "Brand profile" })],
    });
  });

  it("stamps database rows and updates a matching row instead of duplicating it", async () => {
    const ctx = await setupChannelTest();
    const created = await rpc(ctx, ctx.principal, "data-database-save", {
      name: "Prospects",
      fields: [
        { id: "title", name: "Name", type: "title" },
        { id: "source", name: "Source URL", type: "url" },
        { id: "notes", name: "Notes", type: "text" },
      ],
      views: [{ id: "table", name: "Table", layout: "table" }],
    });
    expect(created.status).toBe(200);
    const database = (await created.json()) as { id: string };
    const databaseHeaders = { "x-chief-database-id": database.id };

    const first = await rpc(
      ctx,
      ctx.principal,
      "data-database-row-save",
      {
        values: {
          Name: "Ada",
          "Source URL": "https://example.test/ada",
        },
        match: { Name: "Ada" },
      },
      databaseHeaders,
    );
    expect(first.status).toBe(200);
    const saved = (await first.json()) as {
      id: string;
      createdBy?: { kind: string; id: string };
      updatedBy?: { kind: string; id: string };
    };
    expect(saved).toMatchObject({
      createdBy: { kind: "user", id: ctx.principal.userId },
      updatedBy: { kind: "user", id: ctx.principal.userId },
    });

    const second = await rpc(
      ctx,
      ctx.principal,
      "data-database-row-save",
      {
        values: { Notes: "Followed up" },
        match: { Name: "Ada" },
      },
      databaseHeaders,
    );
    const updated = (await second.json()) as {
      id: string;
      values: Record<string, string>;
    };
    expect(updated.id).toBe(saved.id);
    expect(updated.values).toMatchObject({
      title: "Ada",
      notes: "Followed up",
    });

    const read = await rpc(
      ctx,
      ctx.principal,
      "data-database-get",
      undefined,
      databaseHeaders,
    );
    const { rows } = (await read.json()) as { rows: unknown[] };
    expect(rows).toHaveLength(1);
  });

  it("lets an agent add a select field and a board view", async () => {
    const ctx = await setupChannelTest();
    const created = await rpc(ctx, ctx.principal, "data-database-save", {
      name: "Prospects",
      fields: [{ id: "title", name: "Name", type: "title" }],
      views: [{ id: "table", name: "Table", layout: "table" }],
    });
    const database = (await created.json()) as { id: string };

    const updated = await rpc(ctx, ctx.principal, "data-database-save", {
      id: database.id,
      fields: [
        { id: "title", name: "Name", type: "title" },
        {
          id: "status",
          name: "Status",
          type: "select",
          options: [
            { id: "new", name: "New", color: "gray" },
            { id: "contacted", name: "Contacted", color: "blue" },
          ],
        },
      ],
      views: [
        { id: "board", name: "Board", layout: "board", groupBy: "status" },
        { id: "table", name: "Table", layout: "table" },
      ],
    });
    expect(await updated.json()).toMatchObject({
      fields: [
        { id: "title", name: "Name", type: "title" },
        { id: "status", name: "Status", type: "select" },
      ],
      views: [
        { id: "board", name: "Board", layout: "board", groupBy: "status" },
        { id: "table", name: "Table", layout: "table" },
      ],
    });
  });

  it("denies specialist data writes outside the agent's granted capability", async () => {
    const ctx = await setupChannelTest();
    const engineerId = agentIdSchema.parse("engineer");
    const pubkey = hexKey("workspace-data-engineer");
    await registerTestAgent(ctx, engineerId, pubkey);
    const engineer = {
      kind: "agent" as const,
      agentId: engineerId,
      pubkey,
      workspaceId: ctx.workspaceId,
      role: "member" as const,
    };

    const brand = await rpc(ctx, engineer, "data-brand-save", {
      markdown: "# Not authorized",
      sourceUrls: ["https://heychief.sh/"],
      conversationId: "engineering",
    });
    expect(brand.status).toBe(403);
  });

  it("persists versioned agent files without allowing path traversal", async () => {
    const ctx = await setupChannelTest();
    await channelRpc(
      ctx,
      ctx.principal,
      "channels-create",
      channelEnvelope({ conversationId: "engineering", name: "engineering" }),
    );
    const engineerId = agentIdSchema.parse("engineer");
    const pubkey = hexKey("workspace-file-engineer");
    await registerTestAgent(ctx, engineerId, pubkey);
    const engineer = {
      kind: "agent" as const,
      agentId: engineerId,
      pubkey,
      workspaceId: ctx.workspaceId,
      role: "member" as const,
    };

    const configured = await channelRpc(
      ctx,
      ctx.principal,
      "agent-config-set",
      {
        agentId: engineerId,
        config: {
          ...defaultAgentConfig,
          toolPermissions: ["workspace.read", "messages.read", "messages.send"],
        },
      },
    );
    expect(configured.status).toBe(200);

    const created = await rpc(ctx, engineer, "data-file-save", {
      path: "engineering/relay-notes.md",
      title: "Relay notes",
      mimeType: "text/markdown",
      content: "# Relay notes",
      conversationId: "engineering",
    });
    expect(created.status).toBe(201);
    const file = (await created.json()) as { id: string; version: number };
    expect(file).toMatchObject({ version: 1 });

    const updated = await rpc(ctx, engineer, "data-file-save", {
      id: file.id,
      path: "engineering/relay-notes.md",
      title: "Relay notes",
      mimeType: "text/markdown",
      content: "# Relay notes\n\nUpdated",
      conversationId: "engineering",
      expectedVersion: 1,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ version: 2 });

    const conflict = await rpc(ctx, engineer, "data-file-save", {
      id: file.id,
      path: "engineering/relay-notes.md",
      title: "Relay notes",
      mimeType: "text/markdown",
      content: "stale",
      conversationId: "engineering",
      expectedVersion: 1,
    });
    expect(conflict.status).toBe(409);

    await channelRpc(
      ctx,
      ctx.principal,
      "channels-create",
      channelEnvelope({ conversationId: "other-work", name: "other-work" }),
    );
    const moved = await rpc(ctx, engineer, "data-file-save", {
      id: file.id,
      path: "engineering/relay-notes.md",
      title: "Moved",
      mimeType: "text/html",
      content: "<p>Moved</p>",
      conversationId: "other-work",
      expectedVersion: 2,
    });
    expect(moved.status).toBe(409);

    const traversal = await rpc(ctx, engineer, "data-file-save", {
      path: "../outside.md",
      title: "Outside",
      mimeType: "text/markdown",
      content: "no",
      conversationId: "engineering",
    });
    expect(traversal.status).toBe(400);
  });

  it("keeps the shared project registry on the relay without local paths", async () => {
    const ctx = await setupChannelTest();
    const engineerId = agentIdSchema.parse("engineer");
    const pubkey = hexKey("workspace-project-engineer");
    await registerTestAgent(ctx, engineerId, pubkey);
    const engineer = {
      kind: "agent" as const,
      agentId: engineerId,
      pubkey,
      workspaceId: ctx.workspaceId,
      role: "member" as const,
    };
    const created = await rpc(ctx, engineer, "data-project-create", {
      name: "Chief",
      repositoryKind: "cloned",
      providerId: "github",
      canonicalRemoteUrl: "https://github.com/latent/chief.git",
      repositoryWebUrl: "https://github.com/latent/chief",
      defaultBranch: "main",
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string };
    expect(project).not.toHaveProperty("repositoryPath");

    const listed = await rpc(ctx, engineer, "data-projects-list");
    const { projects } = relayProjectsResultSchema.parse(await listed.json());
    expect(projects).toEqual([
      expect.objectContaining({
        id: project.id,
        organizationId: ctx.workspaceId,
        canonicalRemoteUrl: "https://github.com/latent/chief.git",
      }),
    ]);
    // A connected repository named after an agent keeps its own content.
    expect(projects[0]?.repositoryFiles).toBeUndefined();
    expect(projects[0]?.agentId).toBeUndefined();

    const deleted = await rpc(ctx, engineer, "data-project-delete", undefined, {
      "x-chief-project-id": project.id,
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ id: project.id, deleted: true });
  });

  it("never gives a connected repository an agent's files because of its name", async () => {
    const ctx = await setupChannelTest();
    const engineerId = agentIdSchema.parse("engineer");
    const pubkey = hexKey("workspace-project-name");
    await registerTestAgent(ctx, engineerId, pubkey);
    const engineer = {
      kind: "agent" as const,
      agentId: engineerId,
      pubkey,
      workspaceId: ctx.workspaceId,
      role: "member" as const,
    };
    const created = await rpc(ctx, engineer, "data-project-create", {
      name: "chief",
      repositoryKind: "cloned",
      providerId: "github",
      canonicalRemoteUrl: "https://github.com/example-org/chief",
      repositoryWebUrl: "https://github.com/example-org/chief",
      defaultBranch: "main",
    });
    expect(created.status).toBe(201);

    const listed = await rpc(ctx, engineer, "data-projects-list");
    const { projects } = relayProjectsResultSchema.parse(await listed.json());
    expect(projects[0]?.canonicalRemoteUrl).toBe(
      "https://github.com/example-org/chief",
    );
    expect(projects[0]?.agentId).toBeUndefined();
    expect(projects[0]?.repositoryFiles).toBeUndefined();
  });

  it("stores machine capabilities and agent grants in the workspace boundary", async () => {
    const ctx = await setupChannelTest();
    const listed = await rpc(ctx, ctx.principal, "data-machines-list");
    expect(await listed.json()).toMatchObject({
      machines: [
        expect.objectContaining({
          name: "Cloudflare Computer",
          kind: "cloudflare",
          status: "online",
          capabilities: ["browser", "screen"],
        }),
      ],
    });

    const created = await rpc(ctx, ctx.principal, "data-machine-create", {
      name: "Raspberry Pi",
      kind: "self-hosted",
      capabilities: ["files", "git", "shell"],
    });
    expect(created.status).toBe(201);
    const machine = (await created.json()) as { id: string };

    const updated = await rpc(
      ctx,
      ctx.principal,
      "data-machine-update",
      {
        name: "Raspberry Pi",
        capabilities: ["files", "git", "shell"],
        agentIds: ["engineer"],
      },
      { "x-chief-machine-id": machine.id },
    );
    expect(await updated.json()).toMatchObject({
      status: "pairing",
      agentIds: ["engineer"],
    });
  });
});

function rpc(
  ctx: Awaited<ReturnType<typeof setupChannelTest>>,
  principal: Parameters<typeof withTrustedContext>[1]["principal"],
  operation: string,
  body?: JsonObject,
  extraHeaders?: Record<string, string>,
) {
  const headers = new Headers({
    "x-chief-internal-operation": operation,
    ...extraHeaders,
  });
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  const request = withTrustedContext(
    new Request("https://workspace.internal", init),
    {
      principal,
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
    },
  );
  const { WORKSPACES: workspaces } = ctx.env;
  return workspaces.get(workspaces.idFromName(ctx.workspaceId)).fetch(request);
}
