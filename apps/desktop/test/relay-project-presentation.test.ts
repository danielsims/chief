import assert from "node:assert/strict";
import test from "node:test";

import {
  relayProjectSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import {
  relayProjectBrowser,
  relayProjectSnapshots,
} from "../src/lib/relay-project-presentation.ts";

void test("uses connected workspace projects before a list response arrives", () => {
  const workspace = workspaceSnapshotSchema.parse({
    id: "workspace-a",
    name: "Acme",
    website: "",
    selectedApps: [],
    runtime: "cloud",
    imageURL: null,
    onboardingComplete: true,
    conversations: [],
    agents: [],
    projects: [
      {
        id: "project-a",
        organizationId: "workspace-a",
        agentId: "researcher",
        name: "researcher-agent",
        repositoryKind: "cloned",
        providerId: "generic-git",
        canonicalRemoteUrl: "https://example.com/researcher-agent.git",
        defaultBranch: "main",
        createdAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T00:00:00.000Z",
      },
    ],
    createdAt: "2026-08-31T00:00:00.000Z",
  });

  const [project] = relayProjectSnapshots(workspace.projects);
  assert.ok(project);
  assert.equal(project.project.id, "project-a");
  assert.equal(project.project.agentId, "researcher");
  assert.equal(project.available, false);
});

void test("browses relay-owned agent source without a local cell", () => {
  const [snapshot] = relayProjectSnapshots([
    relayProjectSchema.parse({
      id: "project-agent",
      organizationId: "workspace-a",
      agentId: "researcher",
      name: "researcher-agent",
      repositoryKind: "cloned",
      providerId: "chief-git",
      repositoryFiles: [
        { path: "README.md", content: "# Researcher\n" },
        {
          path: "agent/instructions.md",
          content: "Return source-backed findings.\n",
        },
      ],
      defaultBranch: "main",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    }),
  ]);
  assert.ok(snapshot);
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.clean, true);

  const root = relayProjectBrowser(snapshot.project, "main", "");
  assert.ok(root);
  assert.deepEqual(
    root.entries.map((entry) => [entry.type, entry.path]),
    [
      ["directory", "agent"],
      ["file", "README.md"],
    ],
  );
  assert.equal(root.readme?.content, "# Researcher\n");

  const file = relayProjectBrowser(
    snapshot.project,
    "main",
    "agent/instructions.md",
  );
  assert.ok(file);
  assert.equal(file.kind, "file");
  assert.equal(file.file?.content, "Return source-backed findings.\n");
});
