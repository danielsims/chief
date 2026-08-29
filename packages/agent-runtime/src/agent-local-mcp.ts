import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import {
  parseJsonObject,
  parseJsonScalar,
  parseJsonString,
  parseJsonValue,
} from "@chief/relay-contracts";

import type { AgentSessionCapability } from "./agent-session-capabilities.js";
import type { localToolsOpenApi } from "./local-tools.js";
import type { McpServerSpec } from "./types.js";
import { permissionForLocalTool } from "./agent-tool-permissions.js";

interface LocalOperation {
  description: string;
  inputSchema: JsonObject;
  method: "DELETE" | "GET" | "PATCH" | "POST";
  path: string;
  title: string;
}

function operationName(operationId: string) {
  const [first = "", ...rest] = operationId.split(".");
  return `localTools.${first}${rest
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")}`;
}

type LocalToolsOpenApi = ReturnType<typeof localToolsOpenApi>;

function object<Input>(value: Input): JsonObject {
  return parseJsonObject(value) ?? {};
}

function resolveSchema(
  value: JsonValue | undefined,
  schemas: JsonObject,
  resolving = new Set<string>(),
): JsonValue {
  if (value === undefined) return {};
  if (Array.isArray(value)) {
    return value.map((item) => resolveSchema(item, schemas, resolving));
  }
  const record = parseJsonObject(value);
  if (!record) return value;
  const reference = parseJsonString(record.$ref);
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
  const body = parseJsonObject(resolvedBody) ?? {};
  const pathParameters = Array.isArray(pathItem.parameters)
    ? pathItem.parameters
    : [];
  const operationParameters = Array.isArray(operation.parameters)
    ? operation.parameters
    : [];
  const parameters = [...pathParameters, ...operationParameters];
  const parameterProperties: JsonObject = {};
  const parameterRequired: string[] = [];
  for (const value of parameters) {
    const parameter = object(value);
    const name = parseJsonString(parameter.name) ?? "";
    const location = parseJsonString(parameter.in) ?? "";
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
      ? body.required.flatMap((value) => {
          const parsed = parseJsonString(value);
          return parsed === undefined ? [] : [parsed];
        })
      : []),
    ...parameterRequired,
  ];
  const schema: JsonObject = {
    ...body,
    type: "object",
    properties,
  };
  if (required.length > 0) schema.required = [...new Set(required)];
  if (body.additionalProperties === undefined) {
    schema.additionalProperties = false;
  }
  return schema;
}

export function agentLocalOperations<Input>(openApi: Input) {
  const specification = object(openApi);
  const paths = object(specification.paths);
  const schemas = object(object(specification.components).schemas);
  const operations = new Map<string, LocalOperation>();
  for (const [path, pathValue] of Object.entries(paths)) {
    const pathItem = object(pathValue);
    for (const method of [
      { key: "get", value: "GET" },
      { key: "post", value: "POST" },
      { key: "patch", value: "PATCH" },
      { key: "delete", value: "DELETE" },
    ] as const) {
      const operation = object(pathItem[method.key]);
      const operationId = parseJsonString(operation.operationId);
      if (!operationId) continue;
      const inputSchema = operationInputSchema(pathItem, operation, schemas);
      const description =
        parseJsonString(operation.description) ??
        parseJsonString(operation.summary) ??
        operationId;
      const title = parseJsonString(operation.summary) ?? operationId;
      operations.set(operationName(operationId), {
        description,
        inputSchema,
        method: method.value,
        path,
        title,
      });
    }
  }
  return operations;
}

function bearerToken(authorization: string | undefined) {
  return /^Bearer (.+)$/.exec(authorization ?? "")?.[1];
}

function readBody(request: IncomingMessage): Promise<JsonValue | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: string | Uint8Array) => {
      if (chunk instanceof Uint8Array) chunks.push(chunk);
      else chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        const parsed = parseJsonValue(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        if (parsed === undefined) throw new Error("Unable to parse JSON.");
        resolve(parsed);
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
    const scalar = parseJsonScalar(value);
    const serialized = scalar === undefined ? "" : String(scalar);
    return encodeURIComponent(serialized);
  });
  const url = new URL(path, origin);
  if (operation.method === "GET") {
    for (const [key, value] of Object.entries(remaining)) {
      if (value === null) continue;
      const text = parseJsonString(value);
      url.searchParams.set(
        key,
        text ?? parseJsonString(JSON.stringify(value)) ?? "",
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
  openApi(): LocalToolsOpenApi;
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
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
      };
      const init: RequestInit = {
        method: operation.method,
        headers,
      };
      if (operation.method !== "GET") {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(target.remaining);
      }
      const result = await fetch(target.url, init);
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
