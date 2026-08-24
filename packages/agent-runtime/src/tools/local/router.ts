import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { JsonObject } from "@chief/relay-contracts";
import { toJsonObject } from "@chief/relay-contracts";

import type { LocalToolContext } from "../../local-tool-context.js";
import type { SessionManager } from "../../manager.js";
import type { LocalTool } from "./tool.js";

export interface LocalToolRouter {
  execute: (input: {
    request: Request;
    body: JsonObject;
    workspaceId: string;
    manager: SessionManager;
    context: LocalToolContext;
  }) => Promise<Response | undefined>;
  paths: () => Record<string, LocalToolOpenApiPath>;
}

export interface LocalToolOpenApiOperation {
  operationId: string;
  summary: string;
  description?: string;
  responses: JsonObject;
  requestBody?: JsonObject;
  parameters?: JsonObject[];
}

export type LocalToolOpenApiPath = Partial<
  Record<"get" | "post" | "patch" | "delete", LocalToolOpenApiOperation>
>;

interface CompiledTool {
  tool: LocalTool;
  match: (path: string) => ReadonlyMap<string, string> | undefined;
}

function compilePath(template: string): CompiledTool["match"] {
  const templateSegments = template.split("/");
  return (path) => {
    const pathSegments = path.split("/");
    if (pathSegments.length !== templateSegments.length) return undefined;
    const parameters = new Map<string, string>();
    for (let index = 0; index < templateSegments.length; index += 1) {
      const expected = templateSegments[index];
      const actual = pathSegments[index];
      if (expected === undefined || actual === undefined) return undefined;
      const parameter = /^\{([^}]+)\}$/u.exec(expected)?.[1];
      if (!parameter) {
        if (expected !== actual) return undefined;
        continue;
      }
      try {
        parameters.set(parameter, decodeURIComponent(actual));
      } catch {
        return undefined;
      }
    }
    return parameters;
  };
}

function pathParameters(path: string): JsonObject[] {
  return [...path.matchAll(/\{([^}]+)\}/gu)].map((match) => ({
    name: match[1] ?? "parameter",
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

const generatedObjectSchema = z.object({
  properties: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .default({}),
  required: z.array(z.string()).default([]),
});

function queryParameters(querySchema: z.ZodTypeAny): JsonObject[] {
  const generated = generatedObjectSchema.safeParse(
    zodToJsonSchema(querySchema, {
      $refStrategy: "none",
      target: "openApi3",
    }),
  );
  if (!generated.success) {
    throw new Error("Local tool query schemas must generate an object schema.");
  }
  const required = new Set(generated.data.required);
  return Object.entries(generated.data.properties).map(([name, schema]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: toJsonObject(schema),
  }));
}

function requestBody(inputSchema: z.ZodTypeAny): JsonObject {
  const schema = toJsonObject(
    zodToJsonSchema(inputSchema, {
      $refStrategy: "none",
      target: "openApi3",
    }),
  );
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

function openApiOperation(tool: LocalTool): LocalToolOpenApiOperation {
  const operation: LocalToolOpenApiOperation = {
    operationId: tool.operation.operationId,
    summary: tool.operation.summary,
    responses: { "200": { description: "Tool operation result" } },
  };
  if (tool.operation.description) {
    operation.description = tool.operation.description;
  }
  const parameters = [
    ...pathParameters(tool.path),
    ...(tool.querySchema ? queryParameters(tool.querySchema) : []),
  ];
  if (parameters.length > 0) operation.parameters = parameters;
  if (tool.inputSchema) operation.requestBody = requestBody(tool.inputSchema);
  return operation;
}

export function createLocalToolRouter(
  tools: readonly LocalTool[],
): LocalToolRouter {
  const compiledTools = tools.map((tool) => ({
    tool,
    match: compilePath(tool.path),
  }));

  return {
    async execute(input) {
      const path = new URL(input.request.url).pathname;
      for (const compiled of compiledTools) {
        if (compiled.tool.method !== input.request.method) continue;
        const parameters = compiled.match(path);
        if (parameters) {
          if (compiled.tool.querySchema) {
            const query = Object.fromEntries(
              new URL(input.request.url).searchParams,
            );
            const parsed = compiled.tool.querySchema.safeParse(query);
            if (!parsed.success) {
              throw new Error(
                parsed.error.issues[0]?.message ??
                  "Valid query parameters are required.",
              );
            }
          }
          return await compiled.tool.execute({
            ...input,
            pathParameters: parameters,
          });
        }
      }
      return undefined;
    },
    paths() {
      const paths: Record<string, LocalToolOpenApiPath> = {};
      for (const tool of tools) {
        paths[tool.path] = {
          ...paths[tool.path],
          [tool.method.toLowerCase()]: openApiOperation(tool),
        };
      }
      return paths;
    },
  };
}
