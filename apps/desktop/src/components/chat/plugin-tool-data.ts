import type {
  AgentPluginSummary,
  ContentBlock,
  PluginAuthorizationAction,
} from "@chief/agent-runtime/types";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && isJsonObject(value) && !Array.isArray(value);
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function structuredToolResult(result: ToolResult | undefined): unknown {
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
  return value as unknown as PluginAuthorizationAction;
}

export function pluginListFromResult(
  result: ToolResult | undefined,
): AgentPluginSummary[] | undefined {
  const value = structuredToolResult(result);
  if (!object(value) || !Array.isArray(value.plugins)) return undefined;
  const plugins = value.plugins.filter(
    (plugin): plugin is AgentPluginSummary =>
      object(plugin) &&
      isJsonString(plugin.id) &&
      isJsonString(plugin.name) &&
      isJsonString(plugin.description) &&
      isJsonString(plugin.status),
  );
  return plugins.length ? plugins : undefined;
}

export function isPluginTool(name: string) {
  const normalized = name.replace(/[^a-z]/gi, "").toLowerCase();
  return (
    normalized.includes("pluginslist") ||
    normalized.includes("pluginsauthorize")
  );
}
