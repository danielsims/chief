import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  LoadedAgentPlugin,
  PortableMcpServer,
  PortablePluginManifest,
} from "./types.js";
import { validateAgentSkill } from "./skill-validator.js";

const MANIFEST_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const NAME = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
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
  "extensions",
]);
const STDIO_KEYS = new Set(["type", "command", "args", "env", "cwd"]);
const REMOTE_KEYS = new Set(["type", "url", "headers"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inside(root: string, candidate: string) {
  const child = relative(root, candidate);
  return (
    child === "" ||
    (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))
  );
}

async function contained(root: string, candidate: string) {
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  if (inside(resolvedRoot, resolvedCandidate)) return resolvedCandidate;
  throw new Error(`Package path escapes the plugin root: ${candidate}`);
}

async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function validateAuthor(value: unknown) {
  if (!object(value)) throw new Error("plugin.json author must be an object.");
  for (const [key, item] of Object.entries(value)) {
    if (!["name", "email", "url"].includes(key) || typeof item !== "string") {
      throw new Error(
        "plugin.json author may contain only name, email, and url strings.",
      );
    }
  }
}

function validateManifest(raw: unknown, diagnostics: string[]) {
  if (!object(raw)) throw new Error("plugin.json must contain a JSON object.");
  if (raw.$schema !== MANIFEST_SCHEMA) {
    throw new Error(
      `plugin.json targets an unsupported schema: ${String(raw.$schema)}`,
    );
  }
  if (typeof raw.name !== "string" || !NAME.test(raw.name)) {
    throw new Error("plugin.json has an invalid portable plugin name.");
  }
  for (const key of Object.keys(raw)) {
    if (!MANIFEST_KEYS.has(key))
      diagnostics.push(`Ignored unknown plugin.json field: ${key}`);
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
  if (raw.author !== undefined) validateAuthor(raw.author);
  if (
    raw.keywords !== undefined &&
    (!Array.isArray(raw.keywords) ||
      raw.keywords.some((item) => typeof item !== "string"))
  ) {
    throw new Error("plugin.json keywords must be a list of strings.");
  }
  if (raw.extensions !== undefined && !object(raw.extensions)) {
    diagnostics.push("Ignored non-object plugin.json field: extensions");
  }
  return raw as unknown as PortablePluginManifest;
}

function assertClosed(
  raw: Record<string, unknown>,
  allowed: Set<string>,
  name: string,
) {
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${name} contains unknown field ${unknown}.`);
}

function configuredPath(root: string, value: string, name: string) {
  const marker = value.startsWith("${PLUGIN_ROOT}")
    ? "${PLUGIN_ROOT}"
    : value.startsWith("${PLUGIN_DATA}")
      ? "${PLUGIN_DATA}"
      : value.startsWith("./")
        ? "."
        : undefined;
  if (!marker || (value !== marker && !value.startsWith(`${marker}/`))) {
    throw new Error(
      `${name} must start with ./, \${PLUGIN_ROOT}, or \${PLUGIN_DATA}.`,
    );
  }
  const suffix = marker === "." ? value : `.${value.slice(marker.length)}`;
  const target = resolve(root, suffix);
  if (!inside(root, target))
    throw new Error(`${name} escapes its configured root.`);
}

async function validateStdio(
  name: string,
  raw: Record<string, unknown>,
  root: string,
) {
  assertClosed(raw, STDIO_KEYS, name);
  if (typeof raw.command !== "string" || raw.command.length === 0) {
    throw new Error(`${name}.command must be one executable token.`);
  }
  const pluginCommand = raw.command.startsWith("./");
  if (!pluginCommand && /[\\/]/.test(raw.command)) {
    throw new Error(`${name}.command must be a PATH name or start with ./`);
  }
  if (pluginCommand && !inside(root, resolve(root, raw.command))) {
    throw new Error(`${name}.command escapes the plugin root.`);
  }
  if (pluginCommand) {
    const command = await contained(root, resolve(root, raw.command));
    if (!(await stat(command)).isFile()) {
      throw new Error(`${name}.command must be a regular package file.`);
    }
  }
  if (
    raw.args !== undefined &&
    (!Array.isArray(raw.args) ||
      raw.args.some((arg) => typeof arg !== "string"))
  ) {
    throw new Error(`${name}.args must be a list of strings.`);
  }
  if (raw.cwd !== undefined) {
    if (typeof raw.cwd !== "string")
      throw new Error(`${name}.cwd must be a string.`);
    configuredPath(root, raw.cwd, `${name}.cwd`);
  }
  if (raw.env !== undefined) {
    if (
      !object(raw.env) ||
      Object.values(raw.env).some((value) => typeof value !== "string")
    ) {
      throw new Error(`${name}.env must contain string values.`);
    }
    if (
      Object.keys(raw.env).some((key) =>
        ["PLUGIN_ROOT", "PLUGIN_DATA"].includes(key),
      )
    ) {
      throw new Error(`${name}.env cannot override reserved plugin variables.`);
    }
  }
  return raw as unknown as PortableMcpServer;
}

function loopback(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

function validateHeaders(name: string, value: unknown) {
  if (value === undefined) return;
  if (!object(value))
    throw new Error(`${name}.headers must contain string values.`);
  const seen = new Set<string>();
  for (const [header, item] of Object.entries(value)) {
    const normalized = header.toLowerCase();
    if (
      !HEADER_NAME.test(header) ||
      seen.has(normalized) ||
      typeof item !== "string" ||
      /[\r\n\0]/.test(item)
    ) {
      throw new Error(
        `${name}.headers contains an invalid or duplicate header.`,
      );
    }
    if (
      /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(
        header,
      )
    ) {
      throw new Error(
        `${name}.headers cannot embed credentials; authorization is client-managed.`,
      );
    }
    seen.add(normalized);
  }
}

function validateRemote(name: string, raw: Record<string, unknown>) {
  assertClosed(raw, REMOTE_KEYS, name);
  if (typeof raw.url !== "string") throw new Error(`${name}.url is required.`);
  const url = new URL(raw.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      `${name}.url must be an HTTP URL without userinfo or a fragment.`,
    );
  }
  if (url.protocol !== "https:" && !loopback(url.hostname)) {
    throw new Error(`${name}.url must use HTTPS outside loopback.`);
  }
  validateHeaders(name, raw.headers);
  return raw as unknown as PortableMcpServer;
}

async function validateMcpServer(name: string, raw: unknown, root: string) {
  if (!object(raw)) throw new Error(`${name} must be an object.`);
  if (raw.type === "stdio") return validateStdio(name, raw, root);
  if (raw.type === "streamable-http" || raw.type === "sse")
    return validateRemote(name, raw);
  throw new Error(`${name} has an unsupported MCP transport.`);
}

async function discoverSkills(root: string, diagnostics: string[]) {
  const skills: LoadedAgentPlugin["skills"] = [];
  let skillsRoot: string;
  try {
    skillsRoot = await contained(root, join(root, "skills"));
    if (!(await stat(skillsRoot)).isDirectory())
      throw new Error("skills is not a directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      diagnostics.push(`Disabled skills: ${String(error)}`);
    return skills;
  }
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const path = await contained(
        root,
        join(skillsRoot, entry.name, "SKILL.md"),
      );
      if (!(await lstat(path)).isFile())
        throw new Error("SKILL.md is not a regular file");
      skills.push(await validateAgentSkill(path, entry.name));
    } catch (error) {
      diagnostics.push(
        `Skipped skill ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return skills;
}

async function discoverMcp(root: string, diagnostics: string[]) {
  const servers: LoadedAgentPlugin["mcpServers"] = [];
  try {
    const path = await contained(root, join(root, "mcp.json"));
    if (!(await stat(path)).isFile())
      throw new Error("mcp.json is not a regular file");
    const raw = await jsonFile(path);
    if (!object(raw) || raw.$schema !== MCP_SCHEMA || !object(raw.mcpServers)) {
      throw new Error(`mcp.json must use ${MCP_SCHEMA} and define mcpServers.`);
    }
    if (
      Object.keys(raw).some((key) => !["$schema", "mcpServers"].includes(key))
    ) {
      throw new Error("mcp.json contains unknown top-level fields.");
    }
    for (const [name, spec] of Object.entries(raw.mcpServers)) {
      try {
        servers.push({ name, spec: await validateMcpServer(name, spec, root) });
      } catch (error) {
        diagnostics.push(
          `Skipped MCP server ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      diagnostics.push(
        `Disabled MCP: ${error instanceof Error ? error.message : String(error)}`,
      );
  }
  return servers;
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
  if (!(await stat(manifestPath)).isFile())
    throw new Error("plugin.json must be a regular file.");
  const manifest = validateManifest(await jsonFile(manifestPath), diagnostics);
  const [skills, mcpServers] = await Promise.all([
    discoverSkills(packageRoot, diagnostics),
    discoverMcp(packageRoot, diagnostics),
  ]);
  if (skills.length === 0 && mcpServers.length === 0) {
    throw new Error(
      `Plugin has no valid skills or MCP servers.${diagnostics.length ? ` ${diagnostics.join(" ")}` : ""}`,
    );
  }
  return { root: packageRoot, manifest, skills, mcpServers, diagnostics };
}
