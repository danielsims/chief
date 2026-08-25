import type { JsonObject } from "@chief/relay-contracts";

import type { LocalTool } from "../tools/tool.js";
import type { AgentToolPermission } from "../types.js";
import type { RelayCellContext } from "./context.js";
import { workspaceTools } from "../tools/toolkits/index.js";

export interface RelayCellTool {
  definition: LocalTool;
  permission: AgentToolPermission;
  execute: (context: RelayCellContext, input: JsonObject) => Promise<object>;
}

export function defineRelayCellTool(
  operationId: string,
  permission: AgentToolPermission,
  execute: RelayCellTool["execute"],
): RelayCellTool {
  const definition = workspaceTools.find(
    (tool) => tool.operation.operationId === operationId,
  );
  if (!definition) throw new Error(`Unknown agent tool: ${operationId}`);
  return { definition, permission, execute };
}
