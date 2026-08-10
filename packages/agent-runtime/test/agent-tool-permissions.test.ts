import assert from "node:assert/strict";
import test from "node:test";

import {
  channelApiOperations,
  scheduledWorkApiOperations,
} from "@chief/channel-api";

import type { AgentToolPermission } from "../src/types.js";
import {
  allAgentToolPermissions,
  combinedAgentToolPermissionCeiling,
  defaultAgentToolPermissions,
  effectiveAgentToolPermissions,
  executorPermissionPolicyAction,
  permissionForExecutorTool,
  permissionForLocalTool,
} from "../src/agent-tool-permissions.js";

void test("Chief and Setup start with the complete local tool surface", () => {
  assert.deepEqual(defaultAgentToolPermissions("cmo"), allAgentToolPermissions);
  assert.deepEqual(
    defaultAgentToolPermissions("setup"),
    allAgentToolPermissions,
  );
});

void test("specialists do not inherit connection or delegation authority", () => {
  const permissions = defaultAgentToolPermissions("engineer");
  assert.equal(permissions.includes("channels.create"), true);
  assert.equal(permissions.includes("members.manage"), true);
  assert.equal(permissions.includes("integrations.manage"), false);
  assert.equal(permissions.includes("agents.delegate"), false);
});

void test("an explicit empty permission list means no access", () => {
  assert.deepEqual(effectiveAgentToolPermissions("cmo", []), []);
});

void test("an empty workspace permission union remains empty", () => {
  assert.deepEqual(
    combinedAgentToolPermissionCeiling([
      { agentId: "engineer", enabled: false },
      { agentId: "researcher", enabled: true, toolPermissions: [] },
    ]),
    [],
  );
});

void test("local operations map to an exact enforceable permission", () => {
  const cases = [
    ["GET", "/local-tools/channels", "channels.read"],
    ["POST", "/local-tools/channels", "channels.create"],
    ["PATCH", "/local-tools/channels/engineering", "channels.update"],
    ["POST", "/local-tools/channels/engineering/archive", "channels.archive"],
    ["POST", "/local-tools/channels/engineering/members", "members.manage"],
    ["GET", "/local-tools/channels/engineering/messages", "messages.read"],
    ["POST", "/local-tools/channels/engineering/messages", "messages.send"],
    [
      "DELETE",
      "/local-tools/channels/engineering/messages/message-1",
      "messages.manage",
    ],
    ["POST", "/local-tools/scheduled-work/work-1/runs", "schedules.run"],
    [
      "POST",
      "/local-tools/scheduled-work/work-1/webhook/rotate",
      "webhooks.manage",
    ],
    ["POST", "/local-tools/browser/open", "browser.use"],
    ["POST", "/local-tools/integrations/provider/open", "integrations.manage"],
    ["POST", "/local-tools/specialists/delegate", "agents.delegate"],
    ["GET", "/local-tools/files", "workspace.read"],
    ["POST", "/local-tools/files/write", "workspace.write"],
  ] as const;
  for (const [method, path, expected] of cases) {
    assert.equal(permissionForLocalTool(method, path), expected, path);
  }
});

void test("every documented agent API operation shares its runtime permission", () => {
  for (const operation of [
    ...channelApiOperations,
    ...scheduledWorkApiOperations,
  ]) {
    if (!operation.path.startsWith("/local-tools/")) continue;
    assert.ok(
      operation.toolPermission,
      `${operation.operationId} must declare a machine-readable permission`,
    );
    const concretePath = operation.path.replaceAll(/\{[^}]+\}/g, "example");
    assert.equal(
      permissionForLocalTool(operation.method, concretePath),
      operation.toolPermission,
      operation.operationId,
    );
  }
});

void test("unknown local tool routes fail closed instead of inheriting workspace write", () => {
  assert.equal(
    permissionForLocalTool("POST", "/local-tools/future-dangerous-action"),
    undefined,
  );
  assert.equal(
    permissionForLocalTool("GET", "/local-tools/future-sensitive-records"),
    undefined,
  );
});

void test("Executor tool paths use the same permission vocabulary", () => {
  assert.equal(
    permissionForExecutorTool("localTools.channelsCreate"),
    "channels.create",
  );
  assert.equal(
    permissionForExecutorTool("localTools.channelsMembersAdd"),
    "members.manage",
  );
  assert.equal(
    permissionForExecutorTool("localTools.scheduledWorkWebhookRotate"),
    "webhooks.manage",
  );
  assert.equal(
    permissionForExecutorTool("localTools.browserOpen"),
    "browser.use",
  );
  assert.equal(
    permissionForExecutorTool("localTools.integrationOpenProviderPage"),
    "integrations.manage",
  );
});

void test("Executor policy is the first hard ceiling for governed tools", () => {
  const ceiling = new Set<AgentToolPermission>([
    "channels.read",
    "messages.read",
  ]);

  assert.equal(
    executorPermissionPolicyAction("localTools.channelsList", ceiling),
    "approve",
  );
  assert.equal(
    executorPermissionPolicyAction("localTools.channelsCreate", ceiling),
    "block",
  );
  assert.equal(
    executorPermissionPolicyAction("localTools.browserOpen", ceiling),
    "block",
  );
  assert.equal(
    executorPermissionPolicyAction("unrelated.tool", ceiling),
    undefined,
  );
});
