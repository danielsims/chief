import { describe, expect, it } from "vitest";

import { workspaceSnapshotSchema } from "@chief/relay-contracts";

import {
  defaultWorkspaceAgents,
  reconcileWorkspaceAgents,
} from "../src/workspace-defaults";

describe("workspace defaults", () => {
  it("creates one directly addressable Chief with nested specialists", () => {
    expect(defaultWorkspaceAgents).toHaveLength(1);
    expect(defaultWorkspaceAgents[0].id).toBe("chief");
    expect(
      defaultWorkspaceAgents[0].subagents.map((agent) => agent.id),
    ).toEqual([
      "brand",
      "content",
      "analyst",
      "prospector",
      "ads",
      "engineer",
      "setup",
    ]);
    expect(
      defaultWorkspaceAgents[0].subagents.every(
        (agent) => agent.instructions.trim().length > 0,
      ),
    ).toBe(true);
  });

  it("preserves an intentionally reduced agent roster", () => {
    const snapshot = workspaceSnapshotSchema.parse({
      id: "workspace-00000000-0000-4000-8000-000000000001",
      name: "Existing workspace",
      createdAt: "2026-08-20T00:00:00.000Z",
      imageURL: null,
      onboardingComplete: true,
      conversations: [],
      agents: [
        {
          id: "chief",
          name: "Chief",
          role: "Chief of staff",
          status: "idle",
        },
      ],
      projects: [],
    });

    const result = reconcileWorkspaceAgents(snapshot);

    expect(result.changed).toBe(false);
    expect(result.snapshot.agents.map((agent) => agent.id)).toEqual(["chief"]);
    expect(result.snapshot.agents[0]?.status).toBe("idle");
  });

  it("leaves a complete roster unchanged", () => {
    const snapshot = workspaceSnapshotSchema.parse({
      id: "workspace-00000000-0000-4000-8000-000000000002",
      name: "Complete workspace",
      createdAt: "2026-08-20T00:00:00.000Z",
      imageURL: null,
      onboardingComplete: true,
      conversations: [],
      agents: [
        { id: "chief", name: "Chief", role: "Chief of staff", status: "idle" },
        { id: "brand", name: "Marketer", role: "Marketing", status: "idle" },
        {
          id: "content",
          name: "Content",
          role: "Content and creative",
          status: "idle",
        },
        {
          id: "analyst",
          name: "Analyst",
          role: "Measurement and reporting",
          status: "idle",
        },
        {
          id: "ads",
          name: "Advertising",
          role: "Paid acquisition",
          status: "idle",
        },
        {
          id: "prospector",
          name: "Prospector",
          role: "Research and outreach",
          status: "idle",
        },
        {
          id: "engineer",
          name: "Engineer",
          role: "Product engineering",
          status: "idle",
        },
        {
          id: "setup",
          name: "Setup",
          role: "Connections and integrations",
          status: "idle",
        },
      ],
      projects: [],
    });

    const result = reconcileWorkspaceAgents(snapshot);

    expect(result).toEqual({ snapshot, changed: false });
  });

  it("makes an existing Mission Control channel public", () => {
    const snapshot = workspaceSnapshotSchema.parse({
      id: "workspace-00000000-0000-4000-8000-000000000003",
      name: "Existing workspace",
      createdAt: "2026-08-20T00:00:00.000Z",
      imageURL: null,
      onboardingComplete: true,
      conversations: [
        {
          id: "mission-control",
          name: "mission-control",
          kind: "channel",
          isPrivate: true,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        },
      ],
      agents: defaultAgents(),
      projects: [],
    });

    const result = reconcileWorkspaceAgents(snapshot);

    expect(result.changed).toBe(true);
    expect(result.snapshot.conversations[0]?.isPrivate).toBe(false);
  });
});

function defaultAgents() {
  return [
    { id: "chief", name: "Chief", role: "Chief of staff", status: "idle" },
    { id: "brand", name: "Marketer", role: "Marketing", status: "idle" },
    {
      id: "content",
      name: "Content",
      role: "Content and creative",
      status: "idle",
    },
    {
      id: "analyst",
      name: "Analyst",
      role: "Measurement and reporting",
      status: "idle",
    },
    {
      id: "ads",
      name: "Advertising",
      role: "Paid acquisition",
      status: "idle",
    },
    {
      id: "prospector",
      name: "Prospector",
      role: "Research and outreach",
      status: "idle",
    },
    {
      id: "engineer",
      name: "Engineer",
      role: "Product engineering",
      status: "idle",
    },
    {
      id: "setup",
      name: "Setup",
      role: "Connections and integrations",
      status: "idle",
    },
  ] as const;
}
