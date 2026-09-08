import { describe, expect, it } from "vitest";

import {
  createWorkspaceCommandSchema,
  provisionWorkspaceCommandSchema,
  userIdSchema,
  workspaceListResultSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import {
  activeManagedWorkspace,
  createManagedWorkspace,
  listManagedWorkspaces,
  switchManagedWorkspace,
} from "../src/workspace-authority";
import { hexKey, relayTestEnv } from "./helpers";

const provision = (commandId: string, name: string) =>
  provisionWorkspaceCommandSchema.parse({
    workspace: createWorkspaceCommandSchema.parse({
      commandId,
      name,
      website: "https://heychief.sh",
      runtime: "phone",
      agentRuntime: "relay-cell",
      inferenceProvider: "openCodeGo",
      inferenceModel: "deepseek-v4-flash",
      selectedApps: [],
    }),
    secrets: { opencode: "test-opencode-key" },
  });

describe("managed workspace selection", () => {
  it("keeps active workspace selection independent for each signed-in device", async () => {
    const relay = relayTestEnv();
    const userId = userIdSchema.parse("multi-device-owner");
    const phone = {
      kind: "user" as const,
      userId,
      pubkey: hexKey("multi-device-owner-phone"),
    };
    const desktop = {
      kind: "user" as const,
      userId,
      pubkey: hexKey("multi-device-owner-desktop"),
    };
    const make = (commandId: string, name: string) =>
      createManagedWorkspace(relay, phone, provision(commandId, name));
    const alpha = workspaceSnapshotSchema.parse(
      await (
        await make("fca0ea44-e52b-48c6-9ad7-000000000011", "Alpha")
      ).json(),
    );
    const beta = workspaceSnapshotSchema.parse(
      await (await make("fca0ea44-e52b-48c6-9ad7-000000000012", "Beta")).json(),
    );
    const activeId = async (identity: typeof phone) =>
      workspaceSnapshotSchema.parse(
        await (await activeManagedWorkspace(relay, identity)).json(),
      ).id;
    const listedActiveId = async (identity: typeof phone) =>
      workspaceListResultSchema
        .parse(await (await listManagedWorkspaces(relay, identity)).json())
        .workspaces.find((item) => item.isActive)?.id;

    expect(await activeId(desktop)).toBe(beta.id);
    await switchManagedWorkspace(relay, phone, alpha.id);

    expect(await activeId(phone)).toBe(alpha.id);
    expect(await activeId(desktop)).toBe(beta.id);
    expect(await listedActiveId(phone)).toBe(alpha.id);
    expect(await listedActiveId(desktop)).toBe(beta.id);
  });
});
