import type { JsonObject } from "@chief/relay-contracts";

import type { AgentToolDefinition } from "../tools/definition.js";
import type { AgentToolPermission } from "../types.js";
import type { RelayCellContext } from "./context.js";
import { localAgentToolsByOperation } from "../tools/model.js";
import { workspaceTools } from "../tools/toolkits/index.js";

export interface RelayCellTool {
  definition: AgentToolDefinition;
  permission: AgentToolPermission;
  execute: (context: RelayCellContext, input: JsonObject) => Promise<object>;
}

export function defineRelayCellTool(
  operationId: string,
  permission: AgentToolPermission,
  execute: RelayCellTool["execute"],
): RelayCellTool {
  const definition =
    workspaceTools.find((tool) => tool.operation.operationId === operationId) ??
    localAgentToolsByOperation([operationId])[0];
  if (!definition) throw new Error(`Unknown agent tool: ${operationId}`);
  return { definition, permission, execute };
}
