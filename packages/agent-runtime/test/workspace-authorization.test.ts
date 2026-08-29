import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilityWhoamiUrl,
  WorkspaceAuthorization,
} from "../src/workspace-authorization.js";

void test("workspace broadcasts only reach sockets authorized for that workspace", () => {
  const authorization = new WorkspaceAuthorization<object>();
  const workspaceA = {};
  const workspaceB = {};
  authorization.connect(workspaceA);
  authorization.connect(workspaceB);
  authorization.authorize(workspaceA, "workspace-a");
  authorization.authorize(workspaceB, "workspace-b");

  assert.equal(authorization.canReceive(workspaceA, "workspace-a"), true);
  assert.equal(authorization.canReceive(workspaceA, "workspace-b"), false);
  assert.equal(authorization.canReceive(workspaceB, "workspace-a"), false);
  assert.equal(authorization.canReceive(workspaceB, "workspace-b"), true);
});

void test("switching a socket revokes its previous workspace", () => {
  const authorization = new WorkspaceAuthorization<object>();
  const socket = {};
  authorization.connect(socket);
  authorization.authorize(socket, "workspace-a");
  authorization.authorize(socket, "workspace-b");

  assert.equal(authorization.canReceive(socket, "workspace-a"), false);
  assert.equal(authorization.canReceive(socket, "workspace-b"), true);
});

void test("capability endpoints accept only the configured issuer", () => {
  assert.throws(
    () => capabilityWhoamiUrl("https://attacker.example.com"),
    /CHIEF_AGENT_TOOLS_ORIGIN/,
  );
  assert.throws(
    () => capabilityWhoamiUrl("http://localhost:3000"),
    /CHIEF_AGENT_TOOLS_ORIGIN/,
  );
  assert.equal(
    capabilityWhoamiUrl("http://localhost:3000", {
      CHIEF_ALLOW_LOCAL_CAPABILITY_ENDPOINT: "1",
    }).toString(),
    "http://localhost:3000/agent-tools/whoami",
  );
  assert.equal(
    capabilityWhoamiUrl("https://tools.example.com", {
      CHIEF_AGENT_TOOLS_ORIGIN: "https://tools.example.com",
    }).origin,
    "https://tools.example.com",
  );
  assert.throws(
    () =>
      capabilityWhoamiUrl("https://attacker.example.com", {
        CHIEF_AGENT_TOOLS_ORIGIN: "https://tools.example.com",
      }),
    /does not match/,
  );
});
