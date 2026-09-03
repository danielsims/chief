import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { eveProjectFiles } from "../src/vercel-eve-provisioning.js";

const environment = {
  CHIEF_AGENT_ID: "researcher",
  CHIEF_CHANNEL_TOKEN: "channel-token",
  CHIEF_DELIVERY_SIGNING_KEY_ID: "dsk_researcher",
  CHIEF_DELIVERY_SIGNING_SECRET: "signing-secret",
  CHIEF_RELAY_URL: "https://relay.example.com",
  CHIEF_WORKSPACE_ID: "workspace-1",
};

void test("packages declared specialists as native Eve subagents", () => {
  const files = eveProjectFiles({
    teamId: "team_chief",
    project: { kind: "new", projectName: "chief" },
    agent: {
      id: "chief",
      name: "Chief",
      description: "Coordinates the workspace.",
      instructions: "# Identity\n\nCoordinate the work.",
      subagents: [
        {
          id: "prospector",
          name: "Prospector",
          role: "Research and outreach",
          description: "Finds qualified prospects.",
          instructions: "# Identity\n\nFind qualified prospects.",
        },
        {
          id: "engineer",
          name: "Engineer",
          role: "Product engineering",
          description: "Works on the product.",
          instructions: "# Identity\n\nWork on the product.",
        },
      ],
      model: "openai/gpt-5.6-terra",
    },
    environment: { ...environment, CHIEF_AGENT_ID: "chief" },
  });
  const paths = files.map((file) => file.path);
  assert.ok(paths.includes("agent/subagents/prospector/agent.ts"));
  assert.ok(paths.includes("agent/subagents/prospector/instructions.md"));
  assert.ok(paths.includes("agent/subagents/engineer/agent.ts"));
  assert.ok(paths.includes("agent/subagents/engineer/instructions.md"));
  const manifest = z
    .object({ subagents: z.array(z.record(z.string(), z.unknown())) })
    .parse(
      JSON.parse(
        files.find((file) => file.path === ".chief/agent.json")?.contents ??
          "{}",
      ),
    );
  assert.deepEqual(manifest.subagents, [
    {
      id: "prospector",
      name: "Prospector",
      role: "Research and outreach",
      description: "Finds qualified prospects.",
      capabilities: [],
      path: "agent/subagents/prospector",
    },
    {
      id: "engineer",
      name: "Engineer",
      role: "Product engineering",
      description: "Works on the product.",
      capabilities: [],
      path: "agent/subagents/engineer",
    },
  ]);
  assert.doesNotMatch(
    files.find((file) => file.path === "agent/instructions.md")?.contents ?? "",
    /Prospector agent instructions/u,
  );
});
