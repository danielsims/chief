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
    const [researcher] = welcomeKickoffTasks(snapshot);
    expect(researcher?.ask).toBe(
      "Hey @Researcher, introduce yourself, what you can help with, and suggest any apps that would make you more useful.",
    );
    expect(researcher?.work).toContain("plugins_recommend");
    expect(researcher?.work).toContain("Exa");
    expect(researcher?.work).toContain("Don't start any work");
    expect(researcher?.skillId).toBeUndefined();
  });

  it("keeps the Marketer's brand profile as its first task", () => {
    const [, marketer] = welcomeKickoffTasks(snapshot);
    expect(marketer?.ask).toBe(
      "Hey @Marketing Lead, use [chief-skill:build-brand-profile] to create a useful working profile from our first-party evidence. Ask one focused question here only if a missing preference materially changes it.",
    );
    expect(marketer?.skillId).toBe("build-brand-profile");
    expect(marketer?.work).toContain("brand_profile_save");
    expect(marketer?.work).toContain("https://example.com");
    expect(marketer?.work).not.toContain("plugins_recommend");
  });

  it("asks the Marketer for a website when the workspace has none", () => {
    const [, marketer] = welcomeKickoffTasks({ ...snapshot, website: "" });
    expect(marketer?.work).toContain("Ask for the website");
    expect(marketer?.skillId).toBe("build-brand-profile");
  });
});
