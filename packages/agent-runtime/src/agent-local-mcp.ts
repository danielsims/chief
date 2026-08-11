import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { AgentSessionCapability } from "./agent-session-capabilities.js";
import type { McpServerSpec } from "./types.js";
import { permissionForLocalTool } from "./agent-tool-permissions.js";

type JsonObject = Record<string, unknown>;

interface LocalOperation {
  description: string;
  inputSchema: JsonObject;
  method: "GET" | "POST";
  path: string;
  title: string;
}

function operationName(operationId: string) {
  const [first = "", ...rest] = operationId.split(".");
  return `localTools.${first}${rest
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")}`;
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function resolveSchema(
  value: unknown,
  schemas: JsonObject,
  resolving = new Set<string>(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveSchema(item, schemas, resolving));
  }
  if (!value || typeof value !== "object") return value;
  const record = value as JsonObject;
  const reference = typeof record.$ref === "string" ? record.$ref : undefined;
  const prefix = "#/components/schemas/";
  if (reference?.startsWith(prefix)) {
    const name = reference.slice(prefix.length);
    if (resolving.has(name)) return { type: "object" };
    const schema = schemas[name];
    if (!schema) return { type: "object" };
    const next = new Set(resolving);
    next.add(name);
    return resolveSchema(schema, schemas, next);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      resolveSchema(child, schemas, resolving),
    ]),
  );
}

function operationInputSchema(
  pathItem: JsonObject,
  operation: JsonObject,
  schemas: JsonObject,
) {
  const media = object(
    object(object(operation.requestBody).content)["application/json"],
  );
  const resolvedBody = resolveSchema(media.schema, schemas);
  const body =
    resolvedBody &&
    typeof resolvedBody === "object" &&
    !Array.isArray(resolvedBody)
      ? (resolvedBody as JsonObject)
      : {};
  const pathParameters = Array.isArray(pathItem.parameters)
    ? (pathItem.parameters as unknown[])
    : [];
  const operationParameters = Array.isArray(operation.parameters)
    ? (operation.parameters as unknown[])
    : [];
  const parameters = [...pathParameters, ...operationParameters];
  const parameterProperties: JsonObject = {};
  const parameterRequired: string[] = [];
  for (const value of parameters) {
    const parameter = object(value);
    const name = typeof parameter.name === "string" ? parameter.name : "";
    const location = typeof parameter.in === "string" ? parameter.in : "";
    if (!name || (location !== "path" && location !== "query")) continue;
    parameterProperties[name] = resolveSchema(parameter.schema, schemas);
    if (location === "path" || parameter.required === true) {
      parameterRequired.push(name);
    }
  }
  const properties = {
    ...object(body.properties),
    ...parameterProperties,
  };
  const required = [
    ...(Array.isArray(body.required)
      ? body.required.filter(
          (value): value is string => typeof value === "string",
        )
      : []),
    ...parameterRequired,
  ];
  return {
    ...body,
    type: "object",
    properties,
    ...(required.length > 0 ? { required: [...new Set(required)] } : {}),
    ...(body.additionalProperties === undefined
      ? { additionalProperties: false }
      : {}),
  } satisfies JsonObject;
}

export function agentLocalOperations(openApi: unknown) {
  const specification = object(openApi);
  const paths = object(specification.paths);
  const schemas = object(object(specification.components).schemas);
  const operations = new Map<string, LocalOperation>();
  for (const [path, pathValue] of Object.entries(paths)) {
    const pathItem = object(pathValue);
    for (const method of ["get", "post"] as const) {
      const operation = object(pathItem[method]);
      const operationId = operation.operationId;
      if (typeof operationId !== "string" || !operationId) continue;
      const inputSchema = operationInputSchema(pathItem, operation, schemas);
      operations.set(operationName(operationId), {
        description:
          typeof operation.description === "string"
            ? operation.description
            : typeof operation.summary === "string"
              ? operation.summary
              : operationId,
        inputSchema,
        method: method.toUpperCase() as "GET" | "POST",
        path,
        title:
          typeof operation.summary === "string"
            ? operation.summary
            : operationId,
      });
    }
  }
  return operations;
}

function bearerToken(authorization: string | undefined) {
  return /^Bearer (.+)$/.exec(authorization ?? "")?.[1];
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: unknown) => {
      if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
      else if (chunk instanceof Uint8Array) chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(
          error instanceof Error ? error : new Error("Unable to parse JSON."),
        );
      }
    });
    request.on("error", reject);
  });
}

function rpcError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32_000, message },
      id: null,
    }),
  );
}

function requestUrl(
  origin: string,
  operation: LocalOperation,
  args: JsonObject,
) {
  let path = operation.path;
  const remaining = { ...args };
  path = path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = remaining[key];
    delete remaining[key];
    const serialized =
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
        ? String(value)
        : "";
    return encodeURIComponent(serialized);
  });
  const url = new URL(path, origin);
  if (operation.method === "GET") {
    for (const [key, value] of Object.entries(remaining)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    }
  }
  return { remaining, url };
}

/**
 * Exposes Chief-owned local tools through an agent-bound MCP capability.
 * Executor remains the governed integration catalog, while host mutations no
 * longer have to infer a caller from several concurrent agent executions.
 */
export function createAgentLocalMcpHandler(dependencies: {
  authenticate(token: string): AgentSessionCapability | undefined;
  openApi(): unknown;
  origin: string;
}) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", dependencies.origin);
    if (url.pathname !== "/agent-local-mcp") return false;
    if (request.method !== "POST") {
      rpcError(response, 405, "This MCP endpoint accepts POST requests only.");
      return true;
    }
    const token = bearerToken(request.headers.authorization);
    const capability = token ? dependencies.authenticate(token) : undefined;
    if (!token || capability?.kind !== "agent-session") {
      rpcError(response, 401, "This agent session is not authorized.");
      return true;
    }
    let body: unknown;
    try {
      body = await readBody(request);
    } catch {
      rpcError(response, 400, "Request body must be valid JSON.");
      return true;
    }

    const operations = agentLocalOperations(dependencies.openApi());
    const visibleOperations = [...operations.entries()].filter(
      ([, operation]) => {
        if (!capability.localToolPermissions) return true;
        const permission = permissionForLocalTool(
          operation.method,
          operation.path,
        );
        return Boolean(
          permission && capability.localToolPermissions.includes(permission),
        );
      },
    );
    const server = new Server(
      { name: "chief-local", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, () =>
      Promise.resolve({
        tools: visibleOperations.map(([name, operation]) => ({
          name,
          title: operation.title,
          description: operation.description,
          inputSchema: operation.inputSchema,
        })),
      }),
    );
    server.setRequestHandler(CallToolRequestSchema, async (toolRequest) => {
      const operation = operations.get(toolRequest.params.name);
      if (!operation) {
        return {
          isError: true,
          content: [{ type: "text", text: "Unknown Chief local tool." }],
        };
      }
      const args = object(toolRequest.params.arguments);
      const target = requestUrl(dependencies.origin, operation, args);
      const result = await fetch(target.url, {
        method: operation.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(operation.method === "POST"
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(operation.method === "POST"
          ? { body: JSON.stringify(target.remaining) }
          : {}),
      });
      const content = await result.text();
      return {
        isError: !result.ok,
        content: [{ type: "text", text: content || String(result.status) }],
      };
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
    return true;
  };
}

export function agentLocalToolServer(
  origin: string,
  token: string,
): McpServerSpec {
  return {
    name: "chief_local",
    command: "",
    args: [],
    url: new URL("/agent-local-mcp", origin).toString(),
    headers: { Authorization: `Bearer ${token}` },
  };
}
