import type {
  AgentPluginSummary,
  ContentBlock,
  PluginAuthorizationAction,
} from "@chief/agent-runtime/types";
import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import {
  isJsonBoolean,
  isJsonObject,
  isJsonString,
  parseJsonValue,
} from "@chief/relay-contracts";

type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

function object(value: JsonValue | undefined): value is JsonObject {
  return isJsonObject(value) && !Array.isArray(value);
}

function parseJson(value: string): JsonValue | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parseJsonValue(parsed);
  } catch {
    return undefined;
  }
}

export function structuredToolResult(
  result: ToolResult | undefined,
): JsonValue | undefined {
  if (!result) return undefined;
  const content = result.content;
  if (isJsonString(content)) return parseJson(content) ?? content;
  if (object(content)) {
    for (const key of ["structuredContent", "content", "value", "result"]) {
      if (content[key] !== undefined) {
        const nested = content[key];
        if (isJsonString(nested)) return parseJson(nested) ?? nested;
        if (object(nested)) return nested;
      }
    }
    return content;
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!object(block)) continue;
      if (object(block.structuredContent)) return block.structuredContent;
      if (isJsonString(block.text)) {
        const parsed = parseJson(block.text);
        if (parsed !== undefined) return parsed;
      }
    }
  }
  return undefined;
}

export function pluginAuthorizationFromResult(
  result: ToolResult | undefined,
): PluginAuthorizationAction | undefined {
  const value = structuredToolResult(result);
  if (
    !object(value) ||
    value.kind !== "plugin_authorization" ||
    value.status !== "authorization_required" ||
    !isJsonString(value.pluginId) ||
    !isJsonString(value.pluginName) ||
    !isJsonString(value.description) ||
    !isJsonString(value.provider) ||
    !isJsonString(value.authorizationUrl)
  ) {
    return undefined;
  }
  try {
    const url = new URL(value.authorizationUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1")
      return undefined;
  } catch {
    return undefined;
  }
  return {
    kind: "plugin_authorization",
    status: "authorization_required",
    pluginId: value.pluginId,
    pluginName: value.pluginName,
    description: value.description,
    provider: value.provider,
    authorizationUrl: value.authorizationUrl,
  };
}

export function pluginListFromResult(
  result: ToolResult | undefined,
): AgentPluginSummary[] | undefined {
  const value = structuredToolResult(result);
  if (!object(value) || !Array.isArray(value.plugins)) return undefined;
  const plugins = value.plugins.flatMap((plugin) => {
    const summary = pluginSummary(plugin);
    return summary ? [summary] : [];
  });
  return plugins.length ? plugins : undefined;
}

function pluginSummary(value: JsonValue): AgentPluginSummary | undefined {
  if (
    !object(value) ||
    !isJsonString(value.id) ||
    !isJsonString(value.name) ||
    !isJsonString(value.description) ||
    !isJsonString(value.category) ||
    !isJsonString(value.status) ||
    !isPluginStatus(value.status) ||
    !isJsonBoolean(value.enabled) ||
    !isJsonBoolean(value.trusted)
  ) {
    return undefined;
  }
  const source = pluginSource(value.source);
  if (!source) return undefined;
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    category: value.category,
    status: value.status,
    enabled: value.enabled,
    trusted: value.trusted,
    source,
  };
}

function isPluginStatus(value: string): value is AgentPluginSummary["status"] {
  return [
    "available",
    "installed",
    "authorization_required",
    "waiting",
    "connected",
    "failed",
    "reconnect",
    "error",
  ].includes(value);
}

function pluginSource(
  value: JsonValue | undefined,
): AgentPluginSummary["source"] | undefined {
  if (!object(value) || !isJsonString(value.type)) return undefined;
  if (value.type === "bundled" && isJsonString(value.path)) {
    return { type: "bundled", path: value.path };
  }
  if (
    value.type === "git" &&
    isJsonString(value.url) &&
    isJsonString(value.sha) &&
    (value.path === undefined || isJsonString(value.path))
  ) {
    const source: AgentPluginSummary["source"] = {
      type: "git",
      url: value.url,
      sha: value.sha,
    };
    if (value.path !== undefined) source.path = value.path;
    return source;
  }
  if (
    value.type === "discovery" &&
    isJsonString(value.registry) &&
    isJsonString(value.domain)
  ) {
    return {
      type: "discovery",
      registry: value.registry,
      domain: value.domain,
    };
  }
  return value.type === "setup" && isJsonString(value.domain)
    ? { type: "setup", domain: value.domain }
    : undefined;
}

export function isPluginTool(name: string) {
  const normalized = name.replace(/[^a-z]/gi, "").toLowerCase();
  return (
    normalized.includes("pluginslist") ||
    normalized.includes("pluginsauthorize")
  );
}
