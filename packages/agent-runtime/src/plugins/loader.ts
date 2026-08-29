import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import {
  isJsonString,
  parseJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

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
const fileErrorSchema = z.object({ code: z.string().optional() }).passthrough();

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

async function jsonFile(path: string): Promise<JsonValue> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const value = parseJsonValue(parsed);
  if (value === undefined) throw new Error(`${path} is not valid JSON.`);
  return value;
}

function stringList(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.flatMap((item) => (isJsonString(item) ? [item] : []));
  return strings.length === value.length ? strings : undefined;
}

function stringDictionary(
  value: JsonValue | undefined,
): Record<string, string> | undefined {
  const object = parseJsonObject(value);
  if (!object) return undefined;
  const entries = Object.entries(object);
  if (entries.some(([, item]) => !isJsonString(item))) return undefined;
  return Object.fromEntries(
    entries.flatMap(([key, item]) => (isJsonString(item) ? [[key, item]] : [])),
  );
}

function validateAuthor(value: JsonValue): PortablePluginManifest["author"] {
  const author = parseJsonObject(value);
  if (!author) throw new Error("plugin.json author must be an object.");
  for (const [key, item] of Object.entries(author)) {
    if (!["name", "email", "url"].includes(key) || !isJsonString(item)) {
      throw new Error(
        "plugin.json author may contain only name, email, and url strings.",
      );
    }
  }
  return {
    name: isJsonString(author.name) ? author.name : undefined,
    email: isJsonString(author.email) ? author.email : undefined,
    url: isJsonString(author.url) ? author.url : undefined,
  };
}

function validateManifest(
  value: JsonValue,
  diagnostics: string[],
): PortablePluginManifest {
  const raw = parseJsonObject(value);
  if (!raw) throw new Error("plugin.json must contain a JSON object.");
  if (raw.$schema !== MANIFEST_SCHEMA) {
    throw new Error(
      `plugin.json targets an unsupported schema: ${JSON.stringify(raw.$schema)}`,
    );
  }
  if (!isJsonString(raw.name) || !NAME.test(raw.name)) {
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
    if (raw[key] !== undefined && !isJsonString(raw[key])) {
      throw new Error(`plugin.json field ${key} must be a string.`);
    }
  }
  const keywords =
    raw.keywords === undefined ? undefined : stringList(raw.keywords);
  if (raw.keywords !== undefined && !keywords) {
    throw new Error("plugin.json keywords must be a list of strings.");
  }
  if (raw.extensions !== undefined && !parseJsonObject(raw.extensions)) {
    diagnostics.push("Ignored non-object plugin.json field: extensions");
  }
  return {
    $schema: raw.$schema,
    name: raw.name,
    version: isJsonString(raw.version) ? raw.version : undefined,
    description: isJsonString(raw.description) ? raw.description : undefined,
    author: raw.author === undefined ? undefined : validateAuthor(raw.author),
    homepage: isJsonString(raw.homepage) ? raw.homepage : undefined,
    repository: isJsonString(raw.repository) ? raw.repository : undefined,
    license: isJsonString(raw.license) ? raw.license : undefined,
    keywords,
  };
}

function assertClosed(raw: JsonObject, allowed: Set<string>, name: string) {
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
  raw: JsonObject,
  root: string,
): Promise<PortableMcpServer> {
  assertClosed(raw, STDIO_KEYS, name);
  if (!isJsonString(raw.command) || raw.command.length === 0) {
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
  const args = raw.args === undefined ? undefined : stringList(raw.args);
  if (raw.args !== undefined && !args) {
    throw new Error(`${name}.args must be a list of strings.`);
  }
  if (raw.cwd !== undefined) {
    if (!isJsonString(raw.cwd))
      throw new Error(`${name}.cwd must be a string.`);
    configuredPath(root, raw.cwd, `${name}.cwd`);
  }
  const env = raw.env === undefined ? undefined : stringDictionary(raw.env);
  if (raw.env !== undefined) {
    if (!env) {
      throw new Error(`${name}.env must contain string values.`);
    }
    if (
      Object.keys(env).some((key) =>
        ["PLUGIN_ROOT", "PLUGIN_DATA"].includes(key),
      )
    ) {
      throw new Error(`${name}.env cannot override reserved plugin variables.`);
    }
  }
  return {
    type: "stdio",
    command: raw.command,
    ...(args ? { args } : undefined),
    ...(env ? { env } : undefined),
    ...(isJsonString(raw.cwd) ? { cwd: raw.cwd } : undefined),
  };
}

function loopback(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

function validateHeaders(
  name: string,
  value: JsonValue | undefined,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const headers = stringDictionary(value);
  if (!headers) throw new Error(`${name}.headers must contain string values.`);
  const seen = new Set<string>();
  for (const [header, item] of Object.entries(headers)) {
    const normalized = header.toLowerCase();
    if (
      !HEADER_NAME.test(header) ||
      seen.has(normalized) ||
      !isJsonString(item) ||
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
  return headers;
}

function validateRemote(name: string, raw: JsonObject): PortableMcpServer {
  assertClosed(raw, REMOTE_KEYS, name);
  if (raw.type !== "streamable-http" && raw.type !== "sse") {
    throw new Error(`${name}.type must describe a remote MCP transport.`);
  }
  if (!isJsonString(raw.url)) throw new Error(`${name}.url is required.`);
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
  const headers = validateHeaders(name, raw.headers);
  return {
    type: raw.type,
    url: raw.url,
    ...(headers ? { headers } : undefined),
  };
}

async function validateMcpServer(
  name: string,
  value: JsonValue,
  root: string,
): Promise<PortableMcpServer> {
  const raw = parseJsonObject(value);
  if (!raw) throw new Error(`${name} must be an object.`);
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
    if (fileErrorSchema.safeParse(error).data?.code !== "ENOENT")
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
    const rawObject = parseJsonObject(raw);
    const mcpServers = rawObject
      ? parseJsonObject(rawObject.mcpServers)
      : undefined;
    if (!rawObject || rawObject.$schema !== MCP_SCHEMA || !mcpServers) {
      throw new Error(`mcp.json must use ${MCP_SCHEMA} and define mcpServers.`);
    }
    if (
      Object.keys(rawObject).some(
        (key) => !["$schema", "mcpServers"].includes(key),
      )
    ) {
      throw new Error("mcp.json contains unknown top-level fields.");
    }
    for (const [name, spec] of Object.entries(mcpServers)) {
      try {
        servers.push({ name, spec: await validateMcpServer(name, spec, root) });
      } catch (error) {
        diagnostics.push(
          `Skipped MCP server ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    if (fileErrorSchema.safeParse(error).data?.code !== "ENOENT")
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
