import { describe, expect, it } from "vitest";

import type { JsonValue } from "@chief/relay-contracts";
import {
  createWorkspaceCommandSchema,
  provisionWorkspaceCommandSchema,
  userIdSchema,
  workspaceListResultSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "../src/auth";
import {
  activeManagedWorkspace,
  authorizeWorkspace,
  claimWorkspaceInvite,
  createManagedWorkspace,
  createWorkspaceInvite,
  deleteManagedWorkspace,
  listManagedWorkspaces,
} from "../src/workspace-authority";
import { hexKey, relayTestEnv } from "./helpers";

const provision = (
  workspace: ReturnType<typeof createWorkspaceCommandSchema.parse>,
) =>
  provisionWorkspaceCommandSchema.parse({
    workspace,
    secrets: { opencode: "test-opencode-key" },
  });

describe("managed workspace deletion", () => {
  it("removes the directory entry when atomic workspace provisioning fails", async () => {
    const relay = relayTestEnv();
    const identity = {
      kind: "user" as const,
      userId: userIdSchema.parse("failed-provision-owner"),
      pubkey: hexKey("failed-provision-owner"),
    };
    const workspace = createWorkspaceCommandSchema.parse({
      commandId: "fca0ea44-e52b-48c6-9ad7-000000000013",
      name: "Never visible",
      website: "https://heychief.sh",
      runtime: "phone",
      agentRuntime: "relay-cell",
      inferenceProvider: "openCodeGo",
      inferenceModel: "deepseek-v4-flash",
      selectedApps: [],
    });

    const response = await createManagedWorkspace(relay, identity, {
      workspace,
      secrets: { opencode: "" },
    });
    const listed = workspaceListResultSchema.parse(
      await (await listManagedWorkspaces(relay, identity)).json(),
    );

    expect(response.status).toBe(400);
    expect(listed.workspaces).toEqual([]);
  });

  it("removes an owner's workspace from durable storage and their directory", async () => {
    const relay = relayTestEnv();
    const identity = {
      kind: "user" as const,
      userId: userIdSchema.parse("delete-owner"),
      pubkey: hexKey("delete-owner"),
    };
    const created = await createManagedWorkspace(
      relay,
      identity,
      provision(
        createWorkspaceCommandSchema.parse({
          commandId: "fca0ea44-e52b-48c6-9ad7-000000000021",
          name: "Disposable",
          website: "https://heychief.sh",
          runtime: "phone",
          agentRuntime: "relay-cell",
          inferenceProvider: "openCodeGo",
          inferenceModel: "deepseek-v4-flash",
          selectedApps: [],
        }),
      ),
    );
    const workspace = workspaceSnapshotSchema.parse(await created.json());

    const deleted = await deleteManagedWorkspace(
      relay,
      identity,
      workspace.id,
      crypto.randomUUID(),
    );
    const listed = workspaceListResultSchema.parse(
      await (await listManagedWorkspaces(relay, identity)).json(),
    );
    const active = await activeManagedWorkspace(relay, identity);

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      workspaceId: workspace.id,
      deleted: true,
    });
    expect(listed.workspaces).toEqual([]);
    expect(active.status).toBe(204);
  });

  it("rejects deletion by a workspace member", async () => {
    const relay = relayTestEnv();
    const owner = {
      kind: "user" as const,
      userId: userIdSchema.parse("delete-owner-protected"),
      pubkey: hexKey("delete-owner-protected"),
    };
    const created = await createManagedWorkspace(
      relay,
      owner,
      provision(
        createWorkspaceCommandSchema.parse({
          commandId: crypto.randomUUID(),
          name: "Protected",
          website: "https://heychief.sh",
          runtime: "phone",
          agentRuntime: "relay-cell",
          inferenceProvider: "openCodeGo",
          inferenceModel: "deepseek-v4-flash",
          selectedApps: [],
        }),
      ),
    );
    const workspace = workspaceSnapshotSchema.parse(await created.json());
    const principal = await authorizeWorkspace(relay, {
      identity: owner,
      requestId: crypto.randomUUID(),
      workspaceId: workspace.id,
    });
    const secret = "N_s0L3cH7b3YJfOqoxjjqaMk7HI2KDh56ROHWh-0a8I";
    const invitation = await createWorkspaceInvite(
      relay,
      jsonRequest({
        commandId: crypto.randomUUID(),
        secret,
        conversationId: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: workspace.id,
      },
    );
    expect(invitation.status).toBe(201);

    const member = {
      kind: "user" as const,
      userId: userIdSchema.parse("delete-member"),
      pubkey: hexKey("delete-member"),
    };
    const claimed = await claimWorkspaceInvite(
      relay,
      jsonRequest({ commandId: crypto.randomUUID(), secret }),
      {
        identity: member,
        requestId: crypto.randomUUID(),
        workspaceId: workspace.id,
      },
    );
    expect(claimed.status).toBe(200);

    await expect(
      deleteManagedWorkspace(relay, member, workspace.id, crypto.randomUUID()),
    ).rejects.toThrow(AuthorizationError);
  });
});

function jsonRequest(body: JsonValue) {
  return new Request("https://relay.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
