import type { z } from "zod";

export interface AgentToolDefinition {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  operation: {
    operationId: string;
    summary: string;
    description?: string;
  };
  inputSchema?: z.ZodType<unknown>;
  querySchema?: z.ZodType<unknown>;
}

export function defineAgentTool<const Definition extends AgentToolDefinition>(
  definition: Definition,
) {
  return definition;
}
