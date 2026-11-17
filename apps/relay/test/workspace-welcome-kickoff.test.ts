import { describe, expect, it } from "vitest";

import { workspaceSnapshotSchema } from "@chief/relay-contracts";

import { welcomeKickoffTasks } from "../src/workspace-welcome-kickoff";

const snapshot = workspaceSnapshotSchema.parse({
  id: "workspace-one",
  name: "One",
  website: "https://example.com",
  runtime: "desktop",
  imageURL: null,
  onboardingComplete: true,
  setupComplete: true,
  agents: [
    {
      id: "chief",
      name: "Chief",
      role: "Chief",
      status: "idle",
      subagents: [
        { id: "researcher", name: "Researcher", role: "Research" },
        { id: "brand", name: "Marketing Lead", role: "Marketing" },
      ],
    },
  ],
  conversations: [],
  projects: [],
  createdAt: "2026-08-28T00:00:00.000Z",
});

describe("welcome kickoff", () => {
  it("asks each teammate to introduce themselves and suggest apps, without starting work", () => {
    const [researcher, marketer] = welcomeKickoffTasks(snapshot);
    expect(researcher?.ask).toBe(
      "Hey @Researcher, introduce yourself, what you can help with, and suggest any apps that would make you more useful.",
    );
    expect(researcher?.work).toContain("plugins_recommend");
    expect(researcher?.work).toContain("Exa");
    expect(researcher?.work).toContain("Don't start any work");
    expect(researcher?.skillId).toBeUndefined();

    // Everyone gets the same intro task, including teammates with a card job.
    expect(marketer?.ask).toBe(
      "Hey @Marketing Lead, introduce yourself, what you can help with, and suggest any apps that would make you more useful.",
    );
    expect(marketer?.work).not.toContain("brand_profile_save");
  });
});
