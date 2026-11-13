import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createWorkspaceCommandSchema,
  provisionWorkspaceCommandSchema,
  userIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import {
  activeManagedWorkspace,
  createManagedWorkspace,
  listManagedWorkspaces,
  switchManagedWorkspace,
} from "../src/workspace-authority";
import { hexKey } from "./helpers";

type RelayTestEnvironment = Parameters<typeof createManagedWorkspace>[0];

function relayEnvironment(): RelayTestEnvironment {
  return {
    ...env,
    BETTER_AUTH_SECRET: "test-auth-secret",
    BOOTSTRAP_TOKEN_SHA256: "test-bootstrap-token",
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_EMAIL_API_TOKEN: "test-email-token",
    EMAIL_FROM_ADDRESS: "test@example.test",
    EMAIL_FROM_NAME: "Chief Test",
    RELAY_SECRET_KEY: "test-relay-secret-master-key-0123456789abcdef",
    RELAY_ID: "relay_test",
  };
}

function workspaceCommand(commandId: string, name: string) {
  return createWorkspaceCommandSchema.parse({
    commandId,
    name,
    website: "https://heychief.sh",
    runtime: "phone" as const,
    agentRuntime: "relay-cell",
    inferenceProvider: "openCodeGo",
    inferenceModel: "deepseek-v4-flash",
    selectedApps: [],
  });
}

const provision = (workspace: ReturnType<typeof workspaceCommand>) =>
  provisionWorkspaceCommandSchema.parse({
    workspace,
    secrets: { opencode: "test-opencode-key" },
  });

describe("managed workspace onboarding", () => {
  it("creates a workspace with setup open and only #general", async () => {
    const relay = relayEnvironment();
    const identity = {
      kind: "user" as const,
      userId: userIdSchema.parse("managed-owner"),
      pubkey: hexKey("managed-owner"),
    };
    const command = createWorkspaceCommandSchema.parse({
      commandId: "3384c105-6bf9-443f-b447-0898cfa40d48",
      name: "Chief QA",
      website: "https://heychief.sh",
      runtime: "phone" as const,
      agentRuntime: "relay-cell",
      inferenceProvider: "openCodeGo",
      inferenceModel: "deepseek-v4-flash",
      selectedApps: ["github", "notion"],
    });

    const created = await createManagedWorkspace(
      relay,
      identity,
      provision(command),
    );

    expect(created.status).toBe(200);
    const snapshot = workspaceSnapshotSchema.parse(await created.json());
    expect(snapshot).toMatchObject({
      setupComplete: false,
      onboardingComplete: false,
    });
    expect(snapshot.conversations.map((entry) => entry.id)).toEqual([
      "general",
    ]);
  });

  it("lists multiple workspaces and switches the active one", async () => {
    const relay = relayEnvironment();
    const identity = {
      kind: "user" as const,
      userId: userIdSchema.parse("multi-owner"),
      pubkey: hexKey("multi-owner"),
    };
    const make = (commandId: string, name: string) =>
      createManagedWorkspace(
        relay,
        identity,
        provision(workspaceCommand(commandId, name)),
      );

    const first = await make("fca0ea44-e52b-48c6-9ad7-000000000001", "Alpha");
    const second = await make("fca0ea44-e52b-48c6-9ad7-000000000002", "Beta");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const alphaId = workspaceSnapshotSchema.parse(await first.json()).id;
    const betaId = workspaceSnapshotSchema.parse(await second.json()).id;

    const listed = await listManagedWorkspaces(relay, identity);
    expect(listed.status).toBe(200);
    const list = (await listed.json()) as {
      workspaces: Array<{
        id: string;
        name: string;
        website: string;
        imageURL: string | null;
        isActive: boolean;
        onboardingComplete: boolean;
      }>;
    };
    expect(list.workspaces).toHaveLength(2);
    expect(list.workspaces.find((w) => w.id === betaId)).toMatchObject({
      name: "Beta",
      website: "https://heychief.sh",
      imageURL: null,
      isActive: true,
    });

    const switched = await switchManagedWorkspace(relay, identity, alphaId);
    expect(switched.status).toBe(200);
    expect(await switched.json()).toMatchObject({
      workspaceId: alphaId,
      isActive: true,
    });

    const active = await activeManagedWorkspace(relay, identity);
    const activeSnapshot = workspaceSnapshotSchema.parse(await active.json());
    expect(activeSnapshot.id).toBe(alphaId);
  });
});
