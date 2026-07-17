import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { SessionManager } from "./manager.js";
import type { AgentEvent, ExecutorCapability } from "./types.js";
import {
  composeWorkspaceInstructions,
  defaultAgents,
  getAgent,
} from "./agents.js";
import {
  availableCapabilities,
  composeAgentCapabilities,
} from "./capabilities/index.js";
import { REMOTE_CHANNEL_ACCESS } from "./channels/access.js";
import { existingExecutorWorkspace } from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import { readWorkspaceContext } from "./workspace-context.js";

const ASK_TIMEOUT_MS = 5 * 60_000;

export function defaultMcpChatId(workspaceId: string) {
  return `mcp-chief-${createHash("sha256").update(workspaceId).digest("hex").slice(0, 24)}`;
}

function lastAssistantText(events: readonly AgentEvent[]) {
  return events
    .flatMap((event) =>
      event.type === "message" && event.role === "assistant"
        ? event.content.flatMap((block) =>
            block.type === "text" ? [block.text] : [],
          )
        : [],
    )
    .at(-1);
}

function jsonRpcError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    }),
  );
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function toolError(content: string) {
  return { ...text(content), isError: true };
}

/**
 * Chief's own MCP surface: any MCP client (Claude Code, Claude Desktop)
 * can inspect the workspace's agent team and talk to Chief. Chats run on the
 * same local runtime path as the app — the user's own agent apps and
 * subscriptions, primed with the workspace context.
 */
export function createChiefMcpHandler(deps: {
  manager: SessionManager;
  authorize: (
    workspaceId: string,
    capability: ExecutorCapability,
  ) => Promise<void>;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const buildServer = (workspaceId: string) => {
    const server = new McpServer({ name: "chief", version: "0.1.0" });

    server.registerTool(
      "list_agents",
      {
        description:
          "List this Chief workspace's agent team: who they are and what each one does.",
      },
      async () => {
        const roster = defaultAgents
          .filter((agent) => agent.id !== "setup")
          .map(
            (agent) =>
              `- ${agent.id} — ${agent.name} (${agent.role}): ${agent.description}`,
          )
          .join("\n");
        return text(
          `${roster}\n\nChief is the user-facing orchestrator. Use ask_chief to compose work; Chief delegates privately when useful.`,
        );
      },
    );

    server.registerTool(
      "ask_chief",
      {
        description:
          "Send a message to the workspace CMO and get its reply. Chief owns the root conversation and delegates to private specialists when useful.",
        inputSchema: {
          message: z.string().describe("What to ask or tell the agent"),
          chatId: z
            .string()
            .optional()
            .describe(
              "Continue a specific Chief conversation; defaults to the ongoing MCP thread",
            ),
        },
      },
      async ({ message, chatId }) => {
        const agent = getAgent("cmo");
        if (!agent) return toolError("The CMO persona is unavailable.");
        const preference = await deps.manager.agentPreference(
          workspaceId,
          "cmo",
        );
        if (!preference?.driver) {
          return toolError(
            `No agent app is configured for ${agent.name}. Open Chief and choose one on the Agents page first.`,
          );
        }

        const capableAgent = preference.capabilities
          ? composeAgentCapabilities(
              agent,
              availableCapabilities.filter((capability) =>
                preference.capabilities!.includes(capability.id),
              ),
            )
          : agent;
        const effectiveAgent = {
          ...capableAgent,
          instructions: composeWorkspaceInstructions(
            capableAgent.instructions,
            readWorkspaceContext(workspaceId),
          ),
        };

        const sessionChatId = chatId ?? defaultMcpChatId(workspaceId);
        const session = await deps.manager.ensureRootChat(
          effectiveAgent,
          sessionChatId,
          {
            driver: preference.driver,
            access: REMOTE_CHANNEL_ACCESS,
            workspaceId,
            model: preference.model,
            executionOwner: "channel",
            mcpServers: [
              executorToolServer(existingExecutorWorkspace(workspaceId)),
            ],
          },
          "Chief via MCP",
        );
        let releaseExecution: () => void;
        try {
          releaseExecution = deps.manager.acquireExecution(
            workspaceId,
            sessionChatId,
            "channel",
          );
        } catch (error) {
          return toolError(
            error instanceof Error ? error.message : "This chat is busy.",
          );
        }
        const reply = await new Promise<string>((resolve) => {
          const finish = (value: string) => {
            releaseExecution();
            resolve(value);
          };
          const timer = setTimeout(() => {
            session.off("event", listener);
            finish(
              "The agent is still working after five minutes; ask again to check in on the same chat.",
            );
          }, ASK_TIMEOUT_MS);
          timer.unref();
          const listener = (event: AgentEvent) => {
            if (event.type === "result") {
              clearTimeout(timer);
              session.off("event", listener);
              finish(
                lastAssistantText(session.events) ??
                  (event.ok
                    ? "The agent finished without a text reply."
                    : `The agent failed: ${event.error ?? "unknown error"}`),
              );
            }
            if (event.type === "error") {
              clearTimeout(timer);
              session.off("event", listener);
              finish(`The agent failed: ${event.message}`);
            }
          };
          session.on("event", listener);
          void session.sendPrompt(message).catch((error: unknown) => {
            clearTimeout(timer);
            session.off("event", listener);
            finish(
              `Could not send the message: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        });
        return text(reply);
      },
    );

    return server;
  };

  return async (req, res) => {
    const path = req.url ? new URL(req.url, "http://localhost").pathname : "/";
    if (path !== "/mcp") return false;

    const authorization = req.headers.authorization;
    const workspaceId = req.headers["x-chief-workspace"];
    const capabilityUrl = req.headers["x-chief-capability-url"];
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : undefined;
    if (!token || typeof workspaceId !== "string" || !workspaceId) {
      jsonRpcError(
        res,
        401,
        "Send Authorization: Bearer <workspace capability token> and x-chief-workspace: <organization id>.",
      );
      return true;
    }
    try {
      await deps.authorize(workspaceId, {
        token,
        apiBaseUrl: typeof capabilityUrl === "string" ? capabilityUrl : "",
      });
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Could not verify access to this workspace.";
      const hint =
        typeof capabilityUrl === "string" && capabilityUrl
          ? ""
          : " If this is the first request since the runtime started, also send x-chief-capability-url: <workspace agent-tools base URL>.";
      jsonRpcError(res, 401, `${reason}${hint}`);
      return true;
    }

    if (req.method !== "POST") {
      jsonRpcError(res, 405, "This MCP endpoint is stateless: POST only.");
      return true;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      jsonRpcError(res, 400, "Request body must be valid JSON.");
      return true;
    }

    // Stateless streamable HTTP: a fresh server + transport per request.
    const server = buildServer(workspaceId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return true;
  };
}
