import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createWorkspaceCommandSchema,
  userIdSchema,
  workspaceListResultSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import {
  activeManagedWorkspace,
  createManagedWorkspace,
  deleteManagedWorkspace,
  listManagedWorkspaces,
} from "../src/workspace-authority";
import { hexKey } from "./helpers";

describe("managed workspace deletion", () => {
  it("removes an owner's workspace from durable storage and their directory", async () => {
    const relay = env as unknown as Parameters<
      typeof createManagedWorkspace
    >[0];
    const identity = {
      kind: "user" as const,
      userId: userIdSchema.parse("delete-owner"),
      pubkey: hexKey("delete-owner"),
    };
    const created = await createManagedWorkspace(
      relay,
      identity,
      createWorkspaceCommandSchema.parse({
        commandId: "fca0ea44-e52b-48c6-9ad7-000000000021",
        name: "Disposable",
        website: "https://heychief.sh",
        runtime: "phone",
        inferenceProvider: "openCodeGo",
        inferenceModel: "deepseek-v4-flash",
        selectedApps: [],
      }),
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
});
