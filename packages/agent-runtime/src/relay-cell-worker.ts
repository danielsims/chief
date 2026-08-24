import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import WebSocket from "ws";

import type { AgentConfig, AgentJob } from "@chief/relay-contracts";
import { createNip98Authorization, RelayClient } from "@chief/relay-client";
import {
  agentConfigSchema,
  parseJsonObject,
  parseJsonString,
} from "@chief/relay-contracts";

import type { AgentEvent, DriverType } from "./types.js";
import { agentSkillById } from "./agent-skills.js";
import { composeWorkspaceInstructions, getAgent } from "./agents.js";
import { DesktopAgentCell } from "./cells/desktop-cell.js";
import { LocalStore } from "./local-store.js";
import { PluginRuntime } from "./plugins/runtime.js";
import { RelayActivityPublisher } from "./relay-activity-publisher.js";
import {
  relayCellToolNames,
  runRelayCellMcpServer,
  startRelayCellMcpHttpServer,
} from "./relay-cell-tools.js";
import { AgentSession } from "./session.js";

const mode = process.argv[2] ?? "worker";
const plugins = new PluginRuntime(() => undefined);

const relayCellHostInstructions = `# Relay cell tool binding

In this relay-hosted cell, the canonical plugin tools are named plugins_list, plugins_recommend, plugins_install, plugins_authorize, and plugins_uninstall. Every agent can discover and recommend plugins. When a user asks to see or choose plugins, call plugins_list if needed and then plugins_recommend in the exact conversation or thread; a prose-only list is not a substitute for the durable cards. Installation and authorization require explicit user approval from a plugin card. Prefer an already connected plugin, then a catalog plugin and its native authorization, then another structured Executor connection. Use the browser only when no structured connection can perform the task or for an unavoidable human sign-in or credential step.

The canonical browser tools are browser_navigate, browser_snapshot, browser_click, browser_type, browser_scroll, browser_back, and browser_release. When the user asks you to open or inspect a public page and these tools are present, use them instead of claiming browser control is unavailable. Navigate, snapshot before drawing conclusions, and release when finished.`;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseConfig(): AgentConfig {
  return agentConfigSchema.parse(
    JSON.parse(requiredEnvironment("CHIEF_AGENT_CONFIG")),
  );
}

function relayClient() {
  const relayUrl = requiredEnvironment("CHIEF_RELAY_URL");
  const secretKey = requiredEnvironment("CHIEF_AGENT_SECRET_KEY");
  return new RelayClient({
    relayUrl,
    workspaceId: requiredEnvironment("CHIEF_WORKSPACE_ID"),
    getAuthorization: (request) =>
      Promise.resolve(createNip98Authorization(secretKey, request)),
  });
}

function workspaceContext(job: AgentJob) {
  const payload = job.payload;
  const name = parseJsonString(payload.name);
  const website = parseJsonString(payload.website);
  const selectedApps = Array.isArray(payload.selectedApps)
    ? payload.selectedApps.flatMap((value) => {
        const app = parseJsonString(value);
        return app === undefined ? [] : [app];
      })
    : [];
  return [
    name ? `Workspace: ${name}` : undefined,
    website ? `Website: ${website}` : undefined,
    selectedApps.length > 0
      ? `Selected apps (relevance only): ${selectedApps.join(", ")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function finalAssistantText(events: readonly AgentEvent[]) {
  return events
    .flatMap((event) =>
      event.type === "message" && event.role === "assistant"
        ? event.content.flatMap((block) =>
            block.type === "text" ? [block.text.trim()] : [],
          )
        : [],
    )
    .filter(Boolean)
    .at(-1);
}

function postedFinalToOrigin(
  events: readonly AgentEvent[],
  conversationId: string,
) {
  return events.some((event) =>
    event.type === "message" && event.role === "assistant"
      ? event.content.some((block) => {
          if (
            block.type !== "tool_use" ||
            !block.name.includes("relay_message_post")
          ) {
            return false;
          }
          const input = parseJsonObject(block.input);
          if (input?.conversationId !== conversationId) return false;
          const key = parseJsonString(input.idempotencyKey) ?? "";
          return key.includes("result") || key.includes("handoff");
        })
      : false,
  );
}

async function executeJob(
  cell: DesktopAgentCell,
  client: RelayClient,
  config: AgentConfig,
  lease: NonNullable<Awaited<ReturnType<RelayClient["claimAgentJob"]>>>,
) {
  const agentId = requiredEnvironment("CHIEF_AGENT_ID");
  const job = lease.job;
  const conversationId = jobConversationId(job);
  const instruction = parseJsonString(job.payload.instruction)?.trim() ?? "";
  if (!instruction) throw new Error("The durable job has no instruction.");
  await cell.enqueue({
    id: job.id,
    type: job.kind,
    payload: job.payload,
    idempotencyKey: job.id,
    createdAt: Date.parse(job.createdAt),
  });
  const runId = randomUUID();
  await cell.leasesManager.acquire(cell.id, {
    runId,
    agentId,
    ttlMs: 5 * 60_000,
  });
  const renew = setInterval(() => {
    void Promise.all([
      cell.leasesManager.renew(cell.id, runId, 5 * 60_000),
      client.renewAgentJob(agentId, lease.leaseToken, 300),
    ]).catch((error) => console.error("[cell] lease renewal:", error));
  }, 60_000);
  renew.unref();
  let relayMcp: Awaited<ReturnType<typeof startRelayCellMcpHttpServer>> | null =
    null;
  let activity: RelayActivityPublisher | null = null;
  let session: AgentSession | null = null;
  const activityContext = {
    relayId: requiredEnvironment("CHIEF_RELAY_URL"),
    workspaceId: job.workspaceId,
    conversationId,
    threadRootId: parseJsonString(job.payload.threadRootId),
    agentId,
    cellId: cell.id,
    jobId: job.id,
    runId,
  };
  console.info(
    "[cell-activity]",
    JSON.stringify({ scope: "cell.run", phase: "started", ...activityContext }),
  );
  try {
    const definition = getAgent(agentId);
    if (!definition) throw new Error(`Unknown agent ${agentId}.`);
    const skillId = parseJsonString(job.payload.skillId);
    const activeSkill = skillId ? agentSkillById(agentId, skillId) : undefined;
    const storedEvents = await cell.readState(`events:${conversationId}`);
    const priorEvents = Array.isArray(storedEvents) ? storedEvents : [];
    const turnStart = priorEvents.length;
    process.env.CHIEF_CONVERSATION_ID = conversationId;
    relayMcp = await startRelayCellMcpHttpServer();
    const agentSession = new AgentSession(
      {
        ...definition,
        instructions: composeWorkspaceInstructions(
          [
            definition.instructions,
            relayCellHostInstructions,
            activeSkill
              ? `# Active skill\n\n${activeSkill.instructions}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n\n"),
          workspaceContext(job),
        ),
      },
      conversationId,
      {
        driver: normalizeDriver(config.driver),
        access: "guarded",
        workspaceId: job.workspaceId,
        model: config.model.toLowerCase() === "auto" ? undefined : config.model,
        mcpServers: [
          relayMcp.spec,
          ...(await plugins.mcpServers(job.workspaceId)),
        ],
        maxPromptAttempts: 3,
      },
      priorEvents,
    );
    session = agentSession;
    const activityPublisher = new RelayActivityPublisher(
      client,
      conversationId,
      parseJsonString(job.payload.threadRootId),
      {
        ...activityContext,
        providerSessionId: () => agentSession.sessionId,
      },
    );
    activity = activityPublisher;
    agentSession.on("event", (event: AgentEvent) => {
      activityPublisher.accept(event);
      if (event.type === "permission") {
        const tool = event.toolName.toLowerCase();
        const allow = relayCellToolNames.some((name) => tool.includes(name));
        agentSession.respondPermission(
          event.requestId,
          allow ? "allow" : "deny",
        );
      }
      void cell
        .writeState(`events:${conversationId}`, agentSession.events.slice(-500))
        .catch((error) => console.error("[cell] event persistence:", error));
    });
    const cellDirectory = requiredEnvironment("CHIEF_CELL_ROOT");
    mkdirSync(cellDirectory, { recursive: true, mode: 0o700 });
    await agentSession.start(
      cellDirectory,
      parseJsonString(
        await cell.readState(`providerSession:${conversationId}`),
      ),
    );
    await agentSession.sendPrompt(instruction, job.id, false, {
      privateInstructions: [
        workspaceContext(job),
        job.kind === "conversation.message"
          ? `Return exactly one user-facing final reply. Do not call relay_message_post for ${conversationId}; Chief publishes your returned reply to that conversation. Use relay_reaction_add sparingly when a reaction is more natural than another acknowledgement, never on your own message, and at most once per user message.`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    await activityPublisher.flush();
    if (agentSession.sessionId) {
      await cell.writeState(
        `providerSession:${conversationId}`,
        agentSession.sessionId,
      );
    }
    await cell.writeState(
      `events:${conversationId}`,
      agentSession.events.slice(-500),
    );
    const turnEvents = agentSession.events.slice(turnStart);
    const reply = finalAssistantText(turnEvents) ?? "Work completed.";
    await agentSession.stop();
    await client.completeAgentJob(agentId, {
      leaseToken: lease.leaseToken,
      outcome: {
        status: "completed",
        result:
          job.kind === "workspace.onboarding"
            ? {
                openingMessage:
                  "Hey, welcome to Chief 👋 I'm getting the team together now. We'll have a look around, get to know your brand and market, and start figuring out where the good opportunities are hiding. You can hang out here and watch us work. I'll give you a shout if I need anything.",
              }
            : postedFinalToOrigin(turnEvents, conversationId)
              ? {}
              : {
                  publishedMessage: {
                    conversationId,
                    body: reply,
                    components: [],
                  },
                },
      },
    });
    console.info(
      "[cell-activity]",
      JSON.stringify({
        scope: "cell.run",
        phase: "completed",
        ...activityContext,
        providerSessionId: agentSession.sessionId,
      }),
    );
  } catch (error) {
    console.error(
      "[cell-activity]",
      JSON.stringify({
        scope: "cell.run",
        phase: "failed",
        ...activityContext,
        providerSessionId: session?.sessionId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    activity?.recordFailure();
    await activity
      ?.flush()
      .catch((publishError) =>
        console.error("[cell] activity failure publication:", publishError),
      );
    const retryAt = new Date(
      Date.now() +
        Math.min(30_000 * 2 ** Math.max(0, job.attempt - 1), 15 * 60_000),
    ).toISOString();
    await client.completeAgentJob(agentId, {
      leaseToken: lease.leaseToken,
      outcome: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        retryAt,
      },
    });
    throw error;
  } finally {
    await relayMcp
      ?.close()
      .catch((error) => console.error("[cell] MCP close:", error));
    clearInterval(renew);
    await cell.leasesManager
      .release(cell.id, runId)
      .catch((error) => console.error("[cell] lease release:", error));
  }
}

function normalizeDriver(driver: string): DriverType {
  if (driver === "openCodeGo") return "opencode";
  if (driver === "codex" || driver === "claude" || driver === "opencode") {
    return driver;
  }
  throw new Error(`The ${driver} provider cannot run in a desktop cell.`);
}

function jobConversationId(job: AgentJob) {
  return (
    parseJsonString(job.payload.conversationId)?.trim() ?? "mission-control"
  );
}

async function drainMailbox(
  cell: DesktopAgentCell,
  client: RelayClient,
  config: AgentConfig,
) {
  const agentId = requiredEnvironment("CHIEF_AGENT_ID");
  while (true) {
    const lease = await client.claimAgentJob(
      agentId,
      `${agentId}-${process.pid}`,
      300,
    );
    if (!lease) return;
    await executeJob(cell, client, config, lease);
  }
}

async function listenForJobs() {
  const config = parseConfig();
  if (!config.enabled) return;
  const client = relayClient();
  const cellRoot = requiredEnvironment("CHIEF_CELL_ROOT");
  const databasePath = join(cellRoot, "cell.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const store = new LocalStore(databasePath);
  await store.health();
  const cell = new DesktopAgentCell(
    `${requiredEnvironment("CHIEF_WORKSPACE_ID")}:${requiredEnvironment("CHIEF_AGENT_ID")}`,
    store.cellStore(),
  );
  let draining: Promise<void> | null = null;
  const drain = () => {
    draining ??= drainMailbox(cell, client, config).finally(() => {
      draining = null;
    });
    return draining;
  };

  let delay = 1_000;
  while (true) {
    try {
      const [discovery, ticket] = await Promise.all([
        client.discovery(),
        client.createAgentMailboxTicket(requiredEnvironment("CHIEF_AGENT_ID")),
      ]);
      const socketUrl = new URL(discovery.websocketUrl);
      socketUrl.searchParams.set(
        "workspaceId",
        requiredEnvironment("CHIEF_WORKSPACE_ID"),
      );
      socketUrl.searchParams.set(
        "agentId",
        requiredEnvironment("CHIEF_AGENT_ID"),
      );
      socketUrl.searchParams.set("ticket", ticket.ticket);
      await new Promise<void>((resolve) => {
        const socket = new WebSocket(socketUrl);
        socket.on("open", () => {
          delay = 1_000;
          void drain().catch((error) => console.error("[cell] job:", error));
        });
        socket.on("message", () => {
          void drain().catch((error) => console.error("[cell] job:", error));
        });
        socket.on("close", resolve);
        socket.on("error", (error) => {
          console.error("[cell] mailbox:", error);
          socket.close();
        });
      });
    } catch (error) {
      console.error("[cell] connection:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 30_000);
  }
}

// A tiny health endpoint lets the native supervisor distinguish a live cell
// process from one that failed before loading its isolated database.
function healthEndpoint() {
  const port = Number(process.env.CHIEF_CELL_HEALTH_PORT ?? 0);
  if (!port) return;
  createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("chief-agent-cell-ready");
  }).listen(port, "127.0.0.1");
}

if (mode === "mcp") {
  await runRelayCellMcpServer();
} else {
  healthEndpoint();
  await listenForJobs();
}
