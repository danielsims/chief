import type { IncomingMessage, ServerResponse } from "node:http";

import type { JsonObject } from "@chief/relay-contracts";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

import type { AgentSessionCapability } from "./agent-session-capabilities.js";
import type { localToolsOpenApi } from "./local-tools.js";
import type { AgentToolPermission, ExecutorCapability } from "./types.js";
import {
  effectiveAgentToolPermissions,
  permissionForLocalTool,
} from "./agent-tool-permissions.js";
import { localToolRequest } from "./http-runtime.js";

interface ActiveLocalToolCaller {
  agentId: string;
  chatId: string;
  threadRootId?: string;
}

interface LocalToolRouteManager {
  activeAgentSession(
    workspaceId: string,
    requestedSessionId?: string,
    requestedSessionIsCredentialBound?: boolean,
  ): ActiveLocalToolCaller | undefined;
  agentPreference(
    workspaceId: string,
    agentId: string,
  ): Promise<
    | {
        enabled?: boolean;
        toolPermissions?: readonly AgentToolPermission[];
      }
    | undefined
  >;
}

type LocalToolsOpenApi = ReturnType<typeof localToolsOpenApi>;
type OpenApiDocument = LocalToolsOpenApi | { openapi: string };

export interface LocalToolRouteRequest {
  body: JsonObject;
  caller: ActiveLocalToolCaller;
  capability: ExecutorCapability;
  path: string;
  requestedSessionId?: string;
  workspaceId: string;
}

/**
 * Binds private workspace mutations to the authenticated agent session.
 *
 * Channel delegation retains its explicit public destination. Setup state,
 * provider authorization, and file attribution belong to the capability-bound
 * caller, so model-authored parent conversation IDs cannot leak their artifacts
 * out of a specialist thread.
 */
export function prepareCallerScopedToolBody(input: {
  path: string;
  body: JsonObject;
  callerAgentId: string;
  callerChatId: string;
  callerThreadRootId?: string;
  attemptId?: string;
}) {
  if (input.path === "/local-tools/action") {
    input.body.sourceId = input.callerChatId;
    if (input.callerThreadRootId) {
      input.body.threadRootId = input.callerThreadRootId;
    } else {
      delete input.body.threadRootId;
    }
    return;
  }
  if (input.path.startsWith("/local-tools/browser/")) {
    input.body.conversationId = input.callerChatId;
    return;
  }
  if (input.path === "/local-tools/setup/start") {
    input.body.conversationId = input.callerChatId;
    return;
  }
  if (input.path.startsWith("/local-tools/integrations/")) {
    input.body.sessionId = input.callerChatId;
    if (input.attemptId) input.body.attemptId = input.attemptId;
    return;
  }
  if (input.path === "/local-tools/files/write") {
    input.body.agentId = input.callerAgentId;
    input.body.sourceSessionId = input.callerChatId;
  }
}

interface LocalToolRouteResult {
  path: string;
  workspaceId: string;
}

interface LocalToolRouteDependencies<Context> {
  capabilities: {
    authenticate(token: string): AgentSessionCapability | undefined;
  };
  createContext(request: LocalToolRouteRequest): Context | Promise<Context>;
  invoke(
    request: Request,
    workspaceId: string,
    context: Context,
  ): Promise<Response>;
  manager: LocalToolRouteManager;
  onSuccess?(result: LocalToolRouteResult): void;
  openApi(): OpenApiDocument;
  origin: string;
  prepareBody?(request: LocalToolRouteRequest): void | Promise<void>;
  workspaceCapabilities: ReadonlyMap<string, ExecutorCapability>;
}

/**
 * Creates the loopback local-tools gateway. This is the single HTTP boundary
 * that authenticates host-issued capabilities, resolves the live agent caller,
 * and enforces that agent's tool permission before any tool implementation runs.
 */
export function createLocalToolsRoute<Context>(
  dependencies: LocalToolRouteDependencies<Context>,
) {
  return async function handleLocalToolsRoute(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url ?? "/", dependencies.origin);
    const path = url.pathname;
    if (request.method === "GET" && path === "/local-tools/openapi.json") {
      writeJson(response, 200, dependencies.openApi());
      return true;
    }
    if (!path.startsWith("/local-tools/")) return false;

    const token = bearerToken(request.headers.authorization);
    const issuedCapability = token
      ? dependencies.capabilities.authenticate(token)
      : undefined;
    const workspaceId = issuedCapability?.workspaceId;
    if (!workspaceId) {
      writeJson(response, 401, { error: "Unauthorized" });
      return true;
    }
    const workspaceCapability =
      dependencies.workspaceCapabilities.get(workspaceId);
    if (!workspaceCapability) {
      writeJson(response, 401, {
        error: "Workspace authorization expired",
      });
      return true;
    }

    const body = await readJsonBody(request);
    const requestedSessionId = requestedSession(url, body);
    const credentialSessionId =
      issuedCapability.kind === "agent-session"
        ? issuedCapability.sessionId
        : undefined;
    const caller = dependencies.manager.activeAgentSession(
      workspaceId,
      credentialSessionId,
      issuedCapability.kind === "agent-session",
    );
    if (
      !caller ||
      (issuedCapability.kind === "agent-session" &&
        (caller.chatId !== issuedCapability.sessionId ||
          caller.agentId !== issuedCapability.agentId))
    ) {
      writeJson(response, 401, {
        error: "This agent session is no longer active.",
        code: "agent_session_inactive",
      });
      return true;
    }

    const permission = permissionForLocalTool(request.method ?? "GET", path);
    if (!permission) {
      writeJson(response, 403, {
        error: "This local tool has no declared agent permission.",
        code: "agent_tool_permission_unmapped",
      });
      return true;
    }
    if (
      issuedCapability.kind === "agent-session" &&
      issuedCapability.localToolPermissions &&
      !issuedCapability.localToolPermissions.includes(permission)
    ) {
      writeJson(response, 403, {
        error: `This scheduled run does not have ${permission} permission.`,
        code: "automation_permission_denied",
        permission,
      });
      return true;
    }
    const preference = await dependencies.manager.agentPreference(
      workspaceId,
      caller.agentId,
    );
    const grantedPermissions = effectiveAgentToolPermissions(
      caller.agentId,
      preference?.toolPermissions,
    );
    if (
      preference?.enabled === false ||
      !grantedPermissions.includes(permission)
    ) {
      writeJson(response, 403, {
        error:
          preference?.enabled === false
            ? "This agent is paused."
            : `This agent does not have ${permission} permission.`,
        code: "agent_permission_denied",
        permission,
      });
      return true;
    }

    const routeRequest = {
      body,
      caller,
      capability: workspaceCapability,
      path,
      requestedSessionId,
      workspaceId,
    } satisfies LocalToolRouteRequest;
    await dependencies.prepareBody?.(routeRequest);
    const toolRequest = localToolRequest({
      origin: dependencies.origin,
      url: request.url,
      method: request.method,
      headers: request.headers,
      body,
    });
    const context = await dependencies.createContext(routeRequest);
    const toolResponse = await dependencies.invoke(
      toolRequest,
      workspaceId,
      context,
    );
    response.writeHead(
      toolResponse.status,
      Object.fromEntries(toolResponse.headers),
    );
    response.end(await toolResponse.text());
    if (request.method === "POST" && toolResponse.ok) {
      dependencies.onSuccess?.({
        path,
        workspaceId,
      });
    }
    return true;
  };
}

function bearerToken(authorization: string | undefined): string | undefined {
  return /^Bearer (.+)$/.exec(authorization ?? "")?.[1];
}

async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    if (isRequestBodyChunk(chunk)) chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  if (raw.length === 0) return {};
  try {
    return parseJsonObject(JSON.parse(raw.toString("utf8"))) ?? {};
  } catch {
    return {};
  }
}

function isRequestBodyChunk(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function requestedSession(
  url: URL,
  body: Readonly<JsonObject>,
): string | undefined {
  return isJsonString(body.sessionId)
    ? body.sessionId
    : isJsonString(body.conversationId)
      ? body.conversationId
      : (url.searchParams.get("sessionId") ?? undefined);
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: JsonObject | OpenApiDocument,
) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
