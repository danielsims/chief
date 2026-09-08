import assert from "node:assert/strict";
import test from "node:test";

import { workspaceDraft } from "../src/pages/workspace-create-draft.js";
import {
  initialWorkspacePageMode,
  shouldLoadEveDestinations,
} from "../src/pages/workspace-new-flow.js";

const commandId = "9e39d10e-9cb8-4b06-96f8-c37dace5654e";

const eveDraft = {
  commandId,
  step: 2,
  name: "Acme",
  website: "",
  provider: "vercelAiGateway" as const,
  agentRuntime: "vercel-eve" as const,
  eveWorkspaceId: null,
  eveAutoDeploy: false,
  eveTeamId: "team_1",
  eveProjectMode: "new" as const,
  eveProjectId: "",
  eveProjectName: "acme-chief",
  page: "create" as const,
  selectedApps: [] as string[],
};

void test("keeps Eve onboarding on the create form until the workspace is created", () => {
  assert.equal(
    initialWorkspacePageMode(false, workspaceDraft(eveDraft), false),
    "create",
  );
});

void test("Add Workspace starts on the chooser instead of the name form", () => {
  assert.equal(
    initialWorkspacePageMode(false, workspaceDraft(eveDraft), true, true),
    "home",
  );
});

void test("resumes Eve deploy only after the workspace already exists", () => {
  assert.equal(
    initialWorkspacePageMode(
      false,
      workspaceDraft({
        ...eveDraft,
        step: 3,
        eveWorkspaceId: "workspace-1",
        eveAutoDeploy: true,
        page: "eve",
      }),
      false,
    ),
    "eve",
  );
});

void test("Eve token continue only loads destinations and does not create the workspace", () => {
  assert.equal(shouldLoadEveDestinations("vercel-eve", 1, 2), true);
  assert.equal(shouldLoadEveDestinations("vercel-eve", 2, 3), false);
  assert.equal(shouldLoadEveDestinations("vercel-eve", 3, 3), false);
  assert.equal(shouldLoadEveDestinations("relay-cell", 1, 2), false);
});
