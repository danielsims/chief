import assert from "node:assert/strict";
import test from "node:test";

import {
  eveDestinationIsReady,
  parseCreateWorkspaceDraft,
  workspaceDraft,
} from "../src/pages/workspace-create-draft.js";

const commandId = "9e39d10e-9cb8-4b06-96f8-c37dace5654e";

void test("workspace drafts retain their runtime and idempotency key", () => {
  const draft = workspaceDraft({
    commandId,
    step: 1,
    name: "Acme",
    website: "https://acme.example",
    provider: "opencode",
    agentRuntime: "relay-cell",
    eveWorkspaceId: null,
    eveAutoDeploy: false,
    eveTeamId: "",
    eveProjectMode: "",
    eveProjectId: "",
    eveProjectName: "",
    page: "create",
    selectedApps: ["notion.so"],
  });

  assert.deepEqual(parseCreateWorkspaceDraft(JSON.stringify(draft)), draft);
});

void test("workspace drafts reject malformed creation identities", () => {
  const draft = workspaceDraft({
    commandId,
    step: 1,
    name: "Acme",
    website: "",
    provider: "opencode",
    agentRuntime: "vercel-eve",
    eveWorkspaceId: "workspace-eve-test",
    eveAutoDeploy: true,
    eveTeamId: "team_1",
    eveProjectMode: "new",
    eveProjectId: "",
    eveProjectName: "acme-chief",
    page: "eve",
    selectedApps: [],
  });

  assert.equal(
    parseCreateWorkspaceDraft(
      JSON.stringify({ ...draft, commandId: "not-a-command" }),
    ),
    null,
  );
});

void test("Eve destination is ready only after a team and project are chosen", () => {
  assert.equal(
    eveDestinationIsReady({
      eveTeamId: "",
      eveProjectMode: "new",
      eveProjectId: "",
      eveProjectName: "acme-chief",
    }),
    false,
  );
  assert.equal(
    eveDestinationIsReady({
      eveTeamId: "team_1",
      eveProjectMode: "new",
      eveProjectId: "",
      eveProjectName: "acme-chief",
    }),
    true,
  );
  assert.equal(
    eveDestinationIsReady({
      eveTeamId: "team_1",
      eveProjectMode: "existing",
      eveProjectId: "",
      eveProjectName: "acme-chief",
    }),
    false,
  );
});
