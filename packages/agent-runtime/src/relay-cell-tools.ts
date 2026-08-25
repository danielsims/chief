import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { AgentConfig } from "@chief/relay-contracts";
import { agentConfigSchema } from "@chief/relay-contracts";

import { cellToolDiagnostic } from "./relay-cell-diagnostics.js";
import { startRelayCellMcpHttpTransport } from "./relay-cell-http-server.js";
import { relayCellContext, requiredEnvironment } from "./relay-cell/context.js";
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

function buildRelayCellMcpServer() {
  const permitted = new Set<string>(parseConfig().toolPermissions);
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
    { name: "chief-relay", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => {
    cellToolDiagnostic("catalog", {
      permissions: [...permitted].sort(),
      toolNames: visibleDefinitions.map((tool) => tool.name),
    });
    return Promise.resolve({ tools: visibleDefinitions });
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
