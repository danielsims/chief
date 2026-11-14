import assert from "node:assert/strict";
import test from "node:test";

import type { DatabaseRowSave, DatabaseSave } from "@chief/relay-contracts";
import { RelayClient } from "@chief/relay-client";

import type { RelayCellContext } from "../src/relay-cell/context.js";
import { relayCellDatabaseTools } from "../src/relay-cell/toolkits/databases.js";

function context(): RelayCellContext {
  return {
    workspaceId: "workspace",
    agentId: "native",
    conversationId: "inbound",
    threadRootId: "thread",
    client: new RelayClient({
      relayUrl: "https://relay.example.com",
      workspaceId: "workspace",
    }),
  };
}
function databaseTool(operationId: string) {
  const tool = relayCellDatabaseTools.find(
    (item) => item.definition.operation.operationId === operationId,
  );
  assert.ok(tool);
  return tool;
}

void test("native cells expose Chief database reads and writes under existing permissions", () => {
  assert.deepEqual(
    relayCellDatabaseTools.map((tool) => [
      tool.definition.operation.operationId,
      tool.permission,
    ]),
    [
      ["databases.list", "workspace.read"],
      ["databases.read", "workspace.read"],
      ["databases.save", "workspace.write"],
      ["databases.rows.save", "workspace.write"],
    ],
  );
});

void test("database row retries preserve matching and use a stable id and source thread", async () => {
  const calls: { databaseId: string; input: DatabaseRowSave }[] = [];
  const ctx = context();
  ctx.client.databases.saveRow = (databaseId, input) => {
    calls.push({ databaseId, input });
    return Promise.resolve({
      id: input.id ?? crypto.randomUUID(),
      values: {},
      body: input.body ?? "",
      position: 0,
      createdAt: 0,
      updatedAt: 0,
    });
  };
  const tool = databaseTool("databases.rows.save");
  const input = {
    databaseId: "new-users",
    values: { Title: "Ada" },
    match: { Email: "ada@example.com" },
    body: "Signup",
  };
  await tool.execute(ctx, input);
  await tool.execute(ctx, { ...input, body: "Updated summary" });
  assert.equal(calls[0]?.input.id, calls[1]?.input.id);
  assert.deepEqual(calls[0]?.input.match, input.match);
  assert.deepEqual(calls[0].input.source, {
    kind: "thread",
    conversationId: "inbound",
    threadRootId: "thread",
  });
  assert.equal(calls[1]?.input.body, "Updated summary");
});

void test("updating a database does not overwrite channel assignments", async () => {
  const saved: DatabaseSave[] = [];
  const ctx = context();
  ctx.client.databases.save = (input) => {
    saved.push(input);
    return Promise.resolve({
      id: input.id ?? "new",
      name: input.name ?? "Database",
      fields: [],
      views: [],
      channels: [],
      createdAt: 0,
      updatedAt: 0,
    });
  };
  await databaseTool("databases.save").execute(ctx, {
    id: "new-users",
    name: "New Users",
  });
  assert.equal(saved[0]?.channels, undefined);
});
