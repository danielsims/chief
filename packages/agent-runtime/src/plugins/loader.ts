import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";

import type {
  LoadedAgentPlugin,
  PortableMcpServer,
  PortablePluginManifest,
} from "./types.js";

const MANIFEST_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const NAME = /^[a-z0-9](?!.*(?:--|\.\.))[a-z0-9.-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
const MANIFEST_KEYS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
]);

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function contained(root: string, candidate: string) {
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  const child = relative(resolvedRoot, resolvedCandidate);
  if (child === "" || (!child.startsWith("..") && !isAbsolute(child))) {
    return resolvedCandidate;
  }
  throw new Error(`Package path escapes the plugin root: ${candidate}`);
}

async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function validateManifest(raw: unknown, diagnostics: string[]) {
  if (!object(raw)) throw new Error("plugin.json must contain a JSON object.");
  if (raw.$schema !== MANIFEST_SCHEMA) {
    throw new Error(`plugin.json must use ${MANIFEST_SCHEMA}.`);
  }
  if (typeof raw.name !== "string" || !NAME.test(raw.name)) {
    throw new Error("plugin.json has an invalid portable plugin name.");
  }
  for (const key of Object.keys(raw)) {
    if (!MANIFEST_KEYS.has(key)) {
      diagnostics.push(`Ignored unknown plugin.json field: ${key}`);
    }
  }
  for (const key of [
    "version",
    "description",
    "homepage",
    "repository",
    "license",
  ] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") {
      throw new Error(`plugin.json field ${key} must be a string.`);
    }
  }
  if (
    raw.keywords !== undefined &&
    (!Array.isArray(raw.keywords) ||
      raw.keywords.some((item) => typeof item !== "string"))
  ) {
    throw new Error("plugin.json keywords must be a list of strings.");
  }
  return raw as unknown as PortablePluginManifest;
}

function isSecretHeader(name: string) {
  return /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(
    name,
  );
}

function validateMcpServer(
  name: string,
  raw: unknown,
  root: string,
): PortableMcpServer {
  if (!object(raw)) throw new Error(`${name} must be an object.`);
  if (raw.type === "stdio") {
    if (
      typeof raw.command !== "string" ||
      !raw.command ||
      /\s/.test(raw.command)
    ) {
      throw new Error(`${name}.command must be one executable token.`);
    }
    if (raw.command.includes(delimiter)) {
      throw new Error(`${name}.command cannot contain a PATH list.`);
    }
    if (/[\\/]/.test(raw.command) && !raw.command.startsWith("./")) {
      throw new Error(`${name}.command must be a PATH name or start with ./`);
    }
    if (
      raw.args !== undefined &&
      (!Array.isArray(raw.args) ||
        raw.args.some((arg) => typeof arg !== "string"))
    ) {
      throw new Error(`${name}.args must be a list of strings.`);
    }
    if (raw.cwd !== undefined && typeof raw.cwd !== "string") {
      throw new Error(`${name}.cwd must be a string.`);
    }
    if (raw.cwd && isAbsolute(raw.cwd)) {
      throw new Error(`${name}.cwd must be package-relative.`);
    }
    if (raw.cwd) {
      const target = resolve(root, raw.cwd);
      const child = relative(root, target);
      if (child.startsWith("..") || isAbsolute(child)) {
        throw new Error(`${name}.cwd escapes the plugin root.`);
      }
    }
    if (
      raw.env !== undefined &&
      (!object(raw.env) ||
        Object.values(raw.env).some((value) => typeof value !== "string"))
    ) {
      throw new Error(`${name}.env must contain string values.`);
    }
    if (raw.command.startsWith("./")) {
      const target = resolve(root, raw.command);
      const child = relative(root, target);
      if (child.startsWith("..") || isAbsolute(child)) {
        throw new Error(`${name}.command escapes the plugin root.`);
      }
    }
    return raw as unknown as PortableMcpServer;
  }
  if (raw.type === "streamable-http" || raw.type === "sse") {
    if (typeof raw.url !== "string")
      throw new Error(`${name}.url is required.`);
    const url = new URL(raw.url);
    if (url.username || url.password || url.hash) {
      throw new Error(`${name}.url cannot contain userinfo or a fragment.`);
    }
    if (
      url.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    ) {
      throw new Error(`${name}.url must use HTTPS outside loopback.`);
    }
    if (object(raw.headers)) {
      for (const [header, value] of Object.entries(raw.headers)) {
        if (typeof value !== "string") {
          throw new Error(`${name}.headers must contain string values.`);
        }
        if (isSecretHeader(header)) {
          throw new Error(
            `${name}.headers cannot embed credentials; authorization is client-managed.`,
          );
        }
      }
    }
    return raw as unknown as PortableMcpServer;
  }
  throw new Error(`${name} has an unsupported MCP transport.`);
}

export async function loadAgentPlugin(
  root: string,
): Promise<LoadedAgentPlugin> {
  const packageRoot = await realpath(root);
  const diagnostics: string[] = [];
  const manifestPath = await contained(
    packageRoot,
    join(packageRoot, "plugin.json"),
  );
  if (!(await stat(manifestPath)).isFile()) {
    throw new Error("plugin.json must be a regular file.");
  }
  const manifest = validateManifest(await jsonFile(manifestPath), diagnostics);
  const skills: LoadedAgentPlugin["skills"] = [];
  try {
    const skillsRoot = await contained(
      packageRoot,
      join(packageRoot, "skills"),
    );
    for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const path = await contained(
          skillsRoot,
          join(skillsRoot, entry.name, "SKILL.md"),
        );
        if (!(await lstat(path)).isFile())
          throw new Error("not a regular file");
        skills.push({ name: entry.name, path });
      } catch (error) {
        diagnostics.push(
          `Skipped skill ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const mcpServers: LoadedAgentPlugin["mcpServers"] = [];
  try {
    const mcpPath = await contained(packageRoot, join(packageRoot, "mcp.json"));
    const raw = await jsonFile(mcpPath);
    if (!object(raw) || raw.$schema !== MCP_SCHEMA || !object(raw.mcpServers)) {
      throw new Error(`mcp.json must use ${MCP_SCHEMA} and define mcpServers.`);
    }
    for (const [name, spec] of Object.entries(raw.mcpServers)) {
      try {
        mcpServers.push({
          name,
          spec: validateMcpServer(name, spec, packageRoot),
        });
      } catch (error) {
        diagnostics.push(
          `Skipped MCP server ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      diagnostics.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (skills.length === 0 && mcpServers.length === 0) {
    throw new Error("Plugin has no valid skills or MCP servers.");
  }
  return { root: packageRoot, manifest, skills, mcpServers, diagnostics };
}
