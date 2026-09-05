import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { channelApiOperations } from "@chief/channel-api";
import { parseJsonObject, toJsonObject } from "@chief/relay-contracts";

import { workspaceTools } from "../src/tools/toolkits/index.js";
import { eveProjectFiles } from "../src/vercel-eve-files.js";
import {
  eveChiefChannelTools,
  eveChiefTools,
  eveToolFileSlug,
} from "../src/vercel-eve-tool-catalog.js";

function pathParameterNames(path: string) {
  return [...path.matchAll(/\{([^}]+)\}/gu)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

function schemaPropertyKeys(schema: z.ZodTypeAny | undefined) {
  if (!schema) return [];
  const json = toJsonObject(
    zodToJsonSchema(schema, { $refStrategy: "none", target: "openApi3" }),
  );
  const properties = parseJsonObject(json.properties);
  return properties ? Object.keys(properties) : [];
}

void test("Eve Chief tools stay aligned with the channel API and local tools", () => {
  for (const tool of eveChiefChannelTools) {
    const api = channelApiOperations.find(
      (operation) => operation.operationId === tool.operationId,
    );
    assert.ok(api, `channel-api is missing ${tool.operationId}`);
    assert.equal(tool.method, api.method);
    assert.equal(tool.path, api.path);
  }
  for (const tool of eveChiefTools) {
    const local = workspaceTools.find(
      (candidate) => candidate.operation.operationId === tool.operationId,
    );
    assert.ok(local, `workspaceTools is missing ${tool.operationId}`);
    assert.equal(local.method, tool.method);
    assert.equal(local.path, tool.path);
    const expected = [
      ...pathParameterNames(local.path),
      ...schemaPropertyKeys(local.inputSchema),
      ...schemaPropertyKeys(local.querySchema),
    ];
    assert.deepEqual([...Object.keys(tool.input)].sort(), [...new Set(expected)].sort());
  }
});

void test("packaged Eve projects include Chief tools generated from the catalog", () => {
  const files = eveProjectFiles({
    teamId: "team_chief",
    project: { kind: "new", projectName: "chief" },
    agent: {
      id: "chief",
      name: "Chief",
      description: "Coordinates the workspace.",
      instructions: "# Identity\n\nCoordinate the work.",
      model: "openai/gpt-5.6-terra",
    },
    environment: {
      CHIEF_AGENT_ID: "chief",
      CHIEF_CHANNEL_TOKEN: "channel-token",
      CHIEF_DELIVERY_SIGNING_KEY_ID: "dsk_chief",
      CHIEF_DELIVERY_SIGNING_SECRET: "signing-secret",
      CHIEF_RELAY_URL: "https://relay.example.com",
      CHIEF_WORKSPACE_ID: "workspace-1",
    },
  });
  const byPath = new Map(files.map((file) => [file.path, file.contents]));
  assert.ok(byPath.has("agent/lib/chief-tool.ts"));
  assert.ok(byPath.has("agent/lib/chief-session.ts"));
  for (const tool of eveChiefTools) {
    const path = `agent/tools/${eveToolFileSlug(tool.operationId)}.ts`;
    const contents = byPath.get(path);
    assert.ok(contents, `missing packaged tool ${path}`);
    assert.match(contents, /defineTool/u);
    assert.match(
      contents,
      new RegExp(`callChiefTool\\(${JSON.stringify(tool.operationId)}`, "u"),
    );
    for (const field of Object.keys(tool.input)) {
      assert.match(contents, new RegExp(`\\b${field}:`, "u"));
    }
  }
  const extraTools = [...byPath.keys()].filter(
    (path) =>
      path.startsWith("agent/tools/") &&
      !eveChiefTools.some(
        (tool) => path === `agent/tools/${eveToolFileSlug(tool.operationId)}.ts`,
      ),
  );
  assert.deepEqual(extraTools, []);
});
