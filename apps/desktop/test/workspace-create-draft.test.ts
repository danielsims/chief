import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCreateWorkspaceDraft,
  WORKSPACE_CREATE_INFERENCE_STEP,
  workspaceDraft,
} from "../src/pages/workspace-create-draft.js";

const commandId = "9e39d10e-9cb8-4b06-96f8-c37dace5654e";

void test("a connected relay advances directly to inference setup", () => {
  assert.equal(WORKSPACE_CREATE_INFERENCE_STEP, 2);
});

void test("workspace drafts retain their relay and idempotency key", () => {
  const draft = workspaceDraft({
    commandId,
    step: 1,
    name: "Acme",
    website: "https://acme.example",
    provider: "opencode",
    selectedApps: ["notion.so"],
    hosting: "self-hosted",
    relayUrl: "http://localhost:8080/path?ignored=true",
    surface: "hosting",
    vercelConnectionOpen: true,
  });

  assert.deepEqual(parseCreateWorkspaceDraft(JSON.stringify(draft)), {
    ...draft,
    relayUrl: "http://localhost:8080",
  });
});

void test("workspace drafts reject malformed creation identities", () => {
  const draft = workspaceDraft({
    commandId,
    step: 1,
    name: "Acme",
    website: "",
    provider: "opencode",
    selectedApps: [],
    hosting: "chief-cloud",
    relayUrl: "https://relay.heychief.sh",
    surface: "create",
    vercelConnectionOpen: false,
  });

  assert.equal(
    parseCreateWorkspaceDraft(
      JSON.stringify({ ...draft, commandId: "not-a-command" }),
    ),
    null,
  );
});
