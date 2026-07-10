import type { IncomingMessage, ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import {
  composeWorkspaceInstructions,
  defaultAgents,
  getAgent,
} from "./agents.js";
import {
  availableCapabilities,
  composeAgentCapabilities,
} from "./capabilities/index.js";
import type { SessionManager } from "./manager.js";
import { existingExecutorWorkspace } from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import type { AgentEvent, ExecutorCapability } from "./types.js";
import { readWorkspaceContext } from "./workspace-context.js";

const ASK_TIMEOUT_MS = 5 * 60_000;

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
 * Marketer's own MCP surface: any MCP client (Claude Code, Claude Desktop)
 * can list the workspace's agent team and talk to it. Sessions run on the
 * same local runtime path as the app — the user's own agent apps and
 * subscriptions, primed with the workspace context.
 */
export function createMarketerMcpHandler(deps: {
  manager: SessionManager;
  authorize: (
    workspaceId: string,
    capability: ExecutorCapability,
  ) => Promise<void>;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const buildServer = (workspaceId: string) => {
    const server = new McpServer({ name: "marketer", version: "0.1.0" });

    server.registerTool(
      "list_agents",
      {
        description:
          "List this Marketer workspace's agent team: who they are and what each one does.",
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
          `${roster}\n\nTalk to any of them with ask_agent({ agentId, message }).`,
        );
      },
    );

    server.registerTool(
      "ask_agent",
      {
        description:
          "Send a message to one of the workspace's agents and get their reply. The agent runs locally on the user's own agent app, primed with the workspace's brand context, with its usual tools.",
        inputSchema: {
          agentId: z
            .string()
            .describe("Agent id from list_agents, e.g. cmo or analyst"),
          message: z.string().describe("What to ask or tell the agent"),
          chatId: z
            .string()
            .optional()
            .describe(
              "Continue a specific conversation; defaults to one ongoing MCP thread per agent",
            ),
        },
      },
      async ({ agentId, message, chatId }) => {
        const agent = getAgent(agentId);
        if (!agent || agent.id === "setup") {
          return toolError(
            `Unknown agent "${agentId}". Call list_agents for the roster.`,
          );
        }
        const preference = await deps.manager.agentPreference(
          workspaceId,
          agent.id,
        );
        if (!preference?.driver) {
          return toolError(
            `No agent app is configured for ${agent.name}. Open Marketer and choose one on the Agents page first.`,
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

        const sessionChatId = chatId ?? `mcp-${agent.id}`;
        const session = await deps.manager.ensure(
          effectiveAgent,
          sessionChatId,
          {
            driver: preference.driver,
            access: "full",
            workspaceId,
            model: preference.model,
            mcpServers: [
              executorToolServer(existingExecutorWorkspace(workspaceId)),
            ],
          },
        );
        deps.manager.retain(sessionChatId);

        const reply = await new Promise<string>((resolve) => {
          const timer = setTimeout(() => {
            session.off("event", listener);
            resolve(
              "The agent is still working after five minutes; ask again to check in on the same chat.",
            );
          }, ASK_TIMEOUT_MS);
          timer.unref();
          const listener = (event: AgentEvent) => {
            if (event.type === "result") {
              clearTimeout(timer);
              session.off("event", listener);
              resolve(
                lastAssistantText(session.events) ??
                  (event.ok
                    ? "The agent finished without a text reply."
                    : `The agent failed: ${event.error ?? "unknown error"}`),
              );
            }
            if (event.type === "error") {
              clearTimeout(timer);
              session.off("event", listener);
              resolve(`The agent failed: ${event.message}`);
            }
          };
          session.on("event", listener);
          void session.sendPrompt(message).catch((error: unknown) => {
            clearTimeout(timer);
            session.off("event", listener);
            resolve(
              `Could not send the message: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        });
        return text(reply);
      },
    );

    server.registerTool(
      "list_automations",
      {
        description:
          "List the workspace's approved recurring agent work (automations) and when each runs next.",
      },
      async () => {
        const { recurringWork } = await deps.manager.workspaceData(workspaceId);
        if (recurringWork.length === 0) {
          return text("No recurring agent work is set up in this workspace.");
        }
        return text(
          recurringWork
            .map((work) => {
              const next = work.nextRunAt
                ? new Date(work.nextRunAt).toISOString()
                : "not scheduled";
              return `- ${work.id} — agent ${work.agentId}, cron "${work.cron}" (${work.timezone}), status ${work.status}, next run ${next}`;
            })
            .join("\n"),
        );
      },
    );

    return server;
  };

  return async (req, res) => {
    const path = req.url
      ? new URL(req.url, "http://localhost").pathname
      : "/";
    if (path !== "/mcp") return false;

    const authorization = req.headers.authorization;
    const workspaceId = req.headers["x-marketer-workspace"];
    const capabilityUrl = req.headers["x-marketer-capability-url"];
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : undefined;
    if (!token || typeof workspaceId !== "string" || !workspaceId) {
      jsonRpcError(
        res,
        401,
        "Send Authorization: Bearer <workspace capability token> and x-marketer-workspace: <organization id>.",
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
          : " If this is the first request since the runtime started, also send x-marketer-capability-url: <workspace agent-tools base URL>.";
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
