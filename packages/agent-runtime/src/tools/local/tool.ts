import type { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";

import type { LocalToolContext } from "../../local-tool-context.js";
import type { SessionManager } from "../../manager.js";

export type LocalToolMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface LocalToolRequest {
  request: Request;
  body: JsonObject;
  pathParameters: ReadonlyMap<string, string>;
  workspaceId: string;
  manager: SessionManager;
  context: LocalToolContext;
}

export interface LocalToolOperation {
  operationId: string;
  summary: string;
  description?: string;
}

interface LocalToolBase {
  method: LocalToolMethod;
  path: string;
  operation: LocalToolOperation;
  querySchema?: z.ZodTypeAny;
  execute: (request: LocalToolRequest) => Response | Promise<Response>;
}

export interface LocalTool extends LocalToolBase {
  inputSchema?: z.ZodTypeAny;
}

interface LocalToolWithInput<Schema extends z.ZodTypeAny> extends Omit<
  LocalToolBase,
  "execute"
> {
  inputSchema: Schema;
  execute: (
    request: LocalToolRequest & { input: z.output<Schema> },
  ) => Response | Promise<Response>;
}

export function defineLocalTool<Schema extends z.ZodTypeAny>(
  tool: LocalToolWithInput<Schema>,
): LocalTool;
export function defineLocalTool<const Tool extends LocalToolBase>(
  tool: Tool,
): Tool;
export function defineLocalTool(
  tool: LocalToolBase | LocalToolWithInput<z.ZodTypeAny>,
): LocalToolBase | LocalTool {
  if (!("inputSchema" in tool)) return tool;
  const { execute, inputSchema, ...definition } = tool;
  return {
    ...definition,
    inputSchema,
    execute(request) {
      const parsed = inputSchema.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path
          .map(String)
          .join(".")
          .replace(/\.(\d+)(?=\.|$)/gu, "[$1]");
        throw new Error(
          path
            ? `${path}: ${issue?.message ?? "Invalid value."}`
            : (issue?.message ?? "A valid input object is required."),
        );
      }
      return execute({ ...request, input: parsed.data });
    },
  };
}
