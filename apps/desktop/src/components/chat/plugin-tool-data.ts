import type {
  AgentPluginSummary,
  ContentBlock,
  PluginAuthorizationAction,
} from "@chief/agent-runtime/types";

type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  if (typeof content === "string") return parseJson(content) ?? content;
  if (object(content)) {
    for (const key of ["structuredContent", "content", "value", "result"]) {
      if (content[key] !== undefined) {
        const nested = content[key];
        if (typeof nested === "string") return parseJson(nested) ?? nested;
        if (object(nested)) return nested;
      }
    }
    return content;
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!object(block)) continue;
      if (object(block.structuredContent)) return block.structuredContent;
      if (typeof block.text === "string") {
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
    typeof value.pluginId !== "string" ||
    typeof value.pluginName !== "string" ||
    typeof value.description !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.authorizationUrl !== "string"
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
      typeof plugin.id === "string" &&
      typeof plugin.name === "string" &&
      typeof plugin.description === "string" &&
      typeof plugin.status === "string",
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
