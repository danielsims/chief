import assert from "node:assert/strict";
import test from "node:test";

import {
  type WorkspaceSnapshot,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { startPendingEveWorkspaceKickoff } from "../src/lib/relay-eve-kickoff.js";

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}) {
  return workspaceSnapshotSchema.parse({
    id: "workspace-00000000-0000-4000-8000-000000000001",
    name: "Program",
    website: "",
    selectedApps: [],
    runtime: "cloud",
    imageURL: null,
    onboardingComplete: false,
    conversations: [],
    agents: [
      {
        id: "chief",
        name: "Chief",
        role: "Coordinator",
        description: "",
        instructions: "",
        capabilities: [],
        status: "idle",
        subagents: [],
        runtime: {
          kind: "external-channel",
          provider: "eve",
          endpoint: "https://chief.vercel.app/channels/chief/messages",
          connectionStatus: "connected",
          deployment: { status: "unattested" },
        },
      },
    ],
    projects: [],
    createdAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  });
}

void test("starts Eve kickoff only for an incomplete connected Eve workspace", () => {
  const calls: string[] = [];
  const client = {
    externalAgents: {
      startWorkspaceKickoff: () => {
        calls.push("start");
        return Promise.resolve({ started: true });
      },
    },
  };

  startPendingEveWorkspaceKickoff(client, snapshot({ onboardingComplete: true }));
  startPendingEveWorkspaceKickoff(
    client,
    snapshot({
      agents: [
        {
          id: "chief",
          name: "Chief",
          role: "Coordinator",
          description: "",
          instructions: "",
          capabilities: [],
          status: "idle",
          subagents: [],
          runtime: { kind: "native-cell" },
        },
      ],
    }),
  );
  startPendingEveWorkspaceKickoff(client, snapshot());
  assert.deepEqual(calls, ["start"]);
});
