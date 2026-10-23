import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { AgentConfig } from "@chief/relay-contracts";
import { agentConfigSchema, parseJsonObject } from "@chief/relay-contracts";

import type { RelayPluginBinding } from "./relay-cell/plugin-tools.js";
import { cellToolDiagnostic } from "./relay-cell-diagnostics.js";
import { startRelayCellMcpHttpTransport } from "./relay-cell-http-server.js";
import { relayCellContext, requiredEnvironment } from "./relay-cell/context.js";
import {
  callRelayPluginTool,
  RELAY_PLUGIN_TOOL_PREFIX,
  relayPluginTools,
} from "./relay-cell/plugin-tools.js";
import { relayCellTools } from "./relay-cell/registry.js";
import {
  localAgentToolDefinitions,
  localAgentToolName,
  parseLocalAgentToolCall,
} from "./tools/model.js";

const toolDefinitions = localAgentToolDefinitions(
  relayCellTools.map((tool) => tool.definition),
).map(({ parameters, ...tool }) => ({ ...tool, inputSchema: parameters }));

function parseConfig(): AgentConfig {
  return agentConfigSchema.parse(
    JSON.parse(requiredEnvironment("CHIEF_AGENT_CONFIG")),
  );
}

export const relayCellToolNames = toolDefinitions.map((tool) => tool.name);

/** Plugin tools are listed per turn; the relay enforces them on each call. */
export function isRelayPluginToolName(name: string) {
  const bare = name.replace(/^mcp__chief_relay__|^mcp\.chief_relay\./u, "");
  return bare.startsWith(RELAY_PLUGIN_TOOL_PREFIX);
}

function buildRelayCellMcpServer() {
  const config = parseConfig();
  const permitted = new Set<string>(config.toolPermissions);
  let plugins: Awaited<ReturnType<typeof relayPluginTools>> | undefined;
  const loadPlugins = async () => {
    // Plugins are extra: an agent with none assigned, or a failed lookup,
    // still gets every Chief tool.
    if (config.integrations.length === 0)
      return (plugins ??= {
        definitions: [],
        bindings: new Map<string, RelayPluginBinding>(),
      });
    plugins ??= await Promise.resolve()
      .then(() => relayPluginTools(relayCellContext(), config.integrations))
      .catch((error: unknown) => {
        cellToolDiagnostic("failed", {
          toolName: "plugins.list",
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          definitions: [],
          bindings: new Map<string, RelayPluginBinding>(),
        };
      });
    return plugins;
  };
  const visibleTools = relayCellTools.filter((tool) =>
    permitted.has(tool.permission),
  );
  const visibleNames = new Set(
    visibleTools.map((tool) => localAgentToolName(tool.definition)),
  );
  const visibleDefinitions = toolDefinitions.filter((tool) =>
    visibleNames.has(tool.name),
  );
  const toolsByName = new Map(
    visibleTools.map((tool) => [localAgentToolName(tool.definition), tool]),
  );
  const server = new Server(
    { name: "relay", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { definitions } = await loadPlugins();
    cellToolDiagnostic("catalog", {
      permissions: [...permitted].sort(),
      toolNames: [...visibleDefinitions, ...definitions].map(
        (tool) => tool.name,
      ),
    });
    return { tools: [...visibleDefinitions, ...definitions] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const binding = (await loadPlugins()).bindings.get(request.params.name);
    if (binding) {
      const input = parseJsonObject(request.params.arguments ?? {});
      if (!input) return unauthorizedToolResult();
      try {
        const result = await callRelayPluginTool(
          relayCellContext(),
          binding,
          input,
        );
        return {
          isError: result.isError,
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    }
    const tool = toolsByName.get(request.params.name);
    if (!tool) return unauthorizedToolResult();
    try {
      cellToolDiagnostic("started", { toolName: request.params.name });
      const parsed = parseLocalAgentToolCall(
        [tool.definition],
        request.params.name,
        request.params.arguments,
      );
      const result = await tool.execute(relayCellContext(), parsed.input);
      cellToolDiagnostic("completed", { toolName: request.params.name });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cellToolDiagnostic("failed", {
        toolName: request.params.name,
        error: message,
      });
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });
  return server;
}

function unauthorizedToolResult() {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: "This cell is not authorized for that tool.",
      },
    ],
  };
}

export async function runRelayCellMcpServer() {
  await buildRelayCellMcpServer().connect(new StdioServerTransport());
}

export function startRelayCellMcpHttpServer() {
  return startRelayCellMcpHttpTransport(buildRelayCellMcpServer);
}
