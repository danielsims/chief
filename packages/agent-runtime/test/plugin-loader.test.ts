import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadAgentPlugin } from "../src/plugins/loader";

const MANIFEST_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

async function packageRoot() {
  const root = await mkdtemp(join(tmpdir(), "chief-plugin-loader-"));
  await writeFile(
    join(root, "plugin.json"),
    JSON.stringify({ $schema: MANIFEST_SCHEMA, name: "test-plugin" }),
  );
  return root;
}

async function writeSkill(root: string, name: string) {
  await mkdir(join(root, "skills", name), { recursive: true });
  await writeFile(
    join(root, "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use this skill for ${name} work.\n---\n\n# ${name}\n`,
  );
}

void test("loads immediate portable skills and isolates invalid MCP siblings", async () => {
  const root = await packageRoot();
  await writeSkill(root, "valid");
  await mkdir(join(root, "skills", "missing"), { recursive: true });
  await writeFile(
    join(root, "mcp.json"),
    JSON.stringify({
      $schema: MCP_SCHEMA,
      mcpServers: {
        posthog: {
          type: "streamable-http",
          url: "https://mcp.posthog.com/mcp",
        },
        embeddedSecret: {
          type: "streamable-http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer no" },
        },
      },
    }),
  );
  const loaded = await loadAgentPlugin(root);
  assert.deepEqual(
    loaded.skills.map((skill) => skill.name),
    ["valid"],
  );
  assert.deepEqual(
    loaded.mcpServers.map((server) => server.name),
    ["posthog"],
  );
  assert.match(loaded.diagnostics.join("\n"), /missing|embeddedSecret/);
});

void test("unknown manifest fields are nonfatal diagnostics", async () => {
  const root = await packageRoot();
  await writeFile(
    join(root, "plugin.json"),
    JSON.stringify({
      $schema: MANIFEST_SCHEMA,
      name: "test-plugin",
      futureField: true,
    }),
  );
  await writeSkill(root, "valid");
  const loaded = await loadAgentPlugin(root);
  assert.match(loaded.diagnostics.join("\n"), /futureField/);
});

void test("rejects a skill symlink that resolves outside the package", async () => {
  const root = await packageRoot();
  const outside = await mkdtemp(join(tmpdir(), "chief-plugin-outside-"));
  await writeFile(join(outside, "SKILL.md"), "# Escaped\n");
  await mkdir(join(root, "skills", "escaped"), { recursive: true });
  await symlink(
    join(outside, "SKILL.md"),
    join(root, "skills", "escaped", "SKILL.md"),
  );
  await writeFile(
    join(root, "mcp.json"),
    JSON.stringify({
      $schema: MCP_SCHEMA,
      mcpServers: {
        safe: { type: "streamable-http", url: "https://example.com/mcp" },
      },
    }),
  );
  const loaded = await loadAgentPlugin(root);
  assert.equal(loaded.skills.length, 0);
  assert.match(loaded.diagnostics.join("\n"), /escapes the plugin root/);
});

void test("rejects a package without a canonical manifest schema", async () => {
  const root = await packageRoot();
  await writeFile(
    join(root, "plugin.json"),
    JSON.stringify({ $schema: "https://example.com/plugin.json", name: "bad" }),
  );
  await assert.rejects(loadAgentPlugin(root), /unsupported schema/);
});

void test("isolates unsafe and malformed portable stdio servers", async () => {
  const root = await packageRoot();
  await writeFile(
    join(root, "mcp.json"),
    JSON.stringify({
      $schema: MCP_SCHEMA,
      mcpServers: {
        valid: {
          type: "stdio",
          command: "node",
          args: ["${PLUGIN_ROOT}/server.mjs"],
          cwd: "./runtime",
          env: { CACHE: "${PLUGIN_DATA}/cache" },
        },
        absoluteCommand: { type: "stdio", command: "/bin/sh" },
        escapedCwd: { type: "stdio", command: "node", cwd: "../outside" },
        nonStringEnv: {
          type: "stdio",
          command: "node",
          env: { TOKEN: 42 },
        },
      },
    }),
  );
  const loaded = await loadAgentPlugin(root);
  assert.deepEqual(
    loaded.mcpServers.map((server) => server.name),
    ["valid"],
  );
  assert.match(loaded.diagnostics.join("\n"), /absoluteCommand/);
  assert.match(loaded.diagnostics.join("\n"), /escapedCwd/);
  assert.match(loaded.diagnostics.join("\n"), /nonStringEnv/);
});

void test("accepts portable extensions and plugin data working directories", async () => {
  const root = await packageRoot();
  await writeFile(
    join(root, "plugin.json"),
    JSON.stringify({
      $schema: MANIFEST_SCHEMA,
      name: "test-plugin",
      extensions: { "com.example.client": { setting: true } },
    }),
  );
  await writeFile(
    join(root, "mcp.json"),
    JSON.stringify({
      $schema: MCP_SCHEMA,
      mcpServers: {
        valid: {
          type: "stdio",
          command: "node",
          cwd: "${PLUGIN_DATA}/runtime",
        },
      },
    }),
  );
  const loaded = await loadAgentPlugin(root);
  assert.equal(loaded.diagnostics.length, 0);
  assert.deepEqual(
    loaded.mcpServers.map((server) => server.name),
    ["valid"],
  );
});

void test("isolates invalid Agent Skill metadata from valid siblings", async () => {
  const root = await packageRoot();
  await writeSkill(root, "valid");
  await mkdir(join(root, "skills", "invalid"), { recursive: true });
  await writeFile(
    join(root, "skills", "invalid", "SKILL.md"),
    "---\nname: wrong-name\ndescription: Invalid.\n---\n",
  );
  const loaded = await loadAgentPlugin(root);
  assert.deepEqual(
    loaded.skills.map((skill) => skill.name),
    ["valid"],
  );
  assert.match(loaded.diagnostics.join("\n"), /invalid.*match directory/);
});
