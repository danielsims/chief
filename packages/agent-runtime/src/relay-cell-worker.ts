import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import WebSocket from "ws";

import type { AgentConfig, AgentJob } from "@chief/relay-contracts";
import {
  createNip98Authorization,
  RelayClient,
  RelayClientError,
} from "@chief/relay-client";
import {
  agentConfigSchema,
  parseJsonObject,
  parseJsonString,
} from "@chief/relay-contracts";

import type { AgentEvent, DriverType } from "./types.js";
import { agentSkillById } from "./agent-skills.js";
import { composeWorkspaceInstructions } from "./agents.js";
import { DesktopAgentCell } from "./cells/desktop-cell.js";
import { ensureCodexSetup } from "./drivers/codex-install.js";
import { LocalStore } from "./local-store.js";
import { PluginRuntime } from "./plugins/runtime.js";
import { RelayActivityPublisher } from "./relay-activity-publisher.js";
import { cellAgentDefinition } from "./relay-cell-agent.js";
import { LocalJobBlockedError, localJobProject } from "./relay-cell-project.js";
import {
  relayCellToolNames,
  runRelayCellMcpServer,
  startRelayCellMcpHttpServer,
} from "./relay-cell-tools.js";
import { AgentSession } from "./session.js";

const mode = process.argv[2] ?? "worker";
const plugins = new PluginRuntime(() => undefined);

const relayCellHostInstructions = `# Relay cell tool binding

In this relay-hosted cell, the canonical plugin tools are named plugins_list and plugins_recommend. Every agent can discover and recommend plugins. When a user asks to see or choose plugins, call plugins_list if needed and then plugins_recommend in the exact conversation or thread; a prose-only list is not a substitute for the durable cards. Installation, authorization and removal happen through user-operated plugin cards; those operations are not agent tools. Prefer an already connected plugin, then a catalog plugin and its native authorization, then another structured Executor connection. Use the browser only when no structured connection can perform the task or for an unavoidable human sign-in or credential step.

The canonical browser tools are browser_open, browser_snapshot, browser_click, browser_fill, browser_select, browser_press, and browser_close. When the user asks you to open or inspect a public page and these tools are present, use them instead of claiming browser control is unavailable. Open the page, snapshot before drawing conclusions, and close it when finished.`;

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

function workspaceContext(job: AgentJob, agentId: string) {
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
    agentId === "setup"
      ? selectedApps.length > 0
        ? `Requested connections: ${selectedApps.join(", ")}. These are setup requests, not proof of access.`
        : "Requested connections: none."
      : "Requested integrations are omitted because they are setup choices, not product, market, or customer evidence.",
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
  threadRootId?: string,
) {
  return events.some((event) =>
    event.type === "message" && event.role === "assistant"
      ? event.content.some((block) => {
          if (
            block.type !== "tool_use" ||
            !block.name.includes("channels_messages_post")
          ) {
            return false;
          }
          const posted = events.some(
            (candidate) =>
              candidate.type === "message" &&
              candidate.content.some(
                (result) =>
                  result.type === "tool_result" &&
                  result.tool_use_id === block.id &&
                  !result.is_error,
              ),
          );
          if (!posted) return false;
          const input = parseJsonObject(block.input);
          if (
            input?.channelId !== conversationId ||
            (parseJsonString(input.threadRootId) ?? undefined) !== threadRootId
          )
            return false;
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
  let session: AgentSession | null = null;
  const renew = setInterval(() => {
    void Promise.all([
      cell.leasesManager.renew(cell.id, runId, 5 * 60_000),
      client.renewAgentJob(agentId, lease.leaseToken, 300),
    ]).catch(async (error: unknown) => {
      console.error("[cell] lease renewal:", error);
      if (error instanceof RelayClientError && error.code === "stale_lease")
        await session?.stop();
    });
  }, 60_000);
  renew.unref();
  let relayMcp: Awaited<ReturnType<typeof startRelayCellMcpHttpServer>> | null =
    null;
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
  const activityPublisher = new RelayActivityPublisher(
    client,
    conversationId,
    activityContext.threadRootId,
    {
      ...activityContext,
      providerSessionId: () => session?.sessionId,
    },
  );
  console.info(
    "[cell-activity]",
    JSON.stringify({ scope: "cell.run", phase: "started", ...activityContext }),
  );
  try {
    const definition = cellAgentDefinition(
      agentId,
      await client.loadOwnAgentProfile(),
    );
    const project = await localJobProject(client, job, agentId, config);
    const skillId = parseJsonString(job.payload.skillId);
    const activeSkill = skillId ? agentSkillById(agentId, skillId) : undefined;
    const sessionKey = `${conversationId}:${activityContext.threadRootId ?? "main"}:${project?.projectId ?? "workspace"}`;
    const storedEvents = await cell.readState(`events:${sessionKey}`);
    const priorEvents = Array.isArray(storedEvents) ? storedEvents : [];
    const turnEvents: AgentEvent[] = [];
    process.env.CHIEF_CONVERSATION_ID = conversationId;
    process.env.CHIEF_THREAD_ROOT_ID =
      parseJsonString(job.payload.threadRootId) ?? "";
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
          workspaceContext(job, agentId),
        ),
      },
      conversationId,
      {
        driver: normalizeDriver(config.inference.provider),
        access: "guarded",
        workspaceId: job.workspaceId,
        model:
          config.inference.model.toLowerCase() === "auto"
            ? undefined
            : config.inference.model,
        mcpServers: [
          relayMcp.spec,
          ...(await plugins.mcpServers(job.workspaceId)),
        ],
        maxPromptAttempts: 3,
      },
      priorEvents,
    );
    session = agentSession;
    agentSession.on("event", (event: AgentEvent) => {
      turnEvents.push(event);
      activityPublisher.accept(event);
      if (event.type === "permission") {
        const tool = event.toolName.toLowerCase();
        const allow = relayCellToolNames.some(
          (name) => tool === name || tool === `mcp__chief_relay__${name}`,
        );
        agentSession.respondPermission(
          event.requestId,
          allow ? "allow" : "deny",
        );
      }
      void cell
        .writeState(`events:${sessionKey}`, agentSession.events.slice(-500))
        .catch((error) => console.error("[cell] event persistence:", error));
    });
    const cellDirectory =
      project?.directory ?? requiredEnvironment("CHIEF_CELL_ROOT");
    mkdirSync(cellDirectory, { recursive: true, mode: 0o700 });
    await agentSession.start(
      cellDirectory,
      parseJsonString(await cell.readState(`providerSession:${sessionKey}`)),
    );
    await agentSession.sendPrompt(instruction, job.id, false, {
      threadRootId: activityContext.threadRootId,
      privateInstructions: [
        workspaceContext(job, agentId),
        project
          ? `Repository: ${project.name} (${project.projectId}). Your working directory is the isolated agent checkout ${project.directory}. Inspect repository instructions before changes. Keep code changes here, run focused checks, and return the diff and evidence for review. Do not deploy, push, or change the original checkout without the user's authorization.`
          : "Use projects_list to inspect connected repositories. If more than one is available, clarify the repository and assign its projectId to the mission before editing code. This session's sandbox is the cell directory.",
        job.kind === "conversation.message" || job.kind === "schedule.step"
          ? `Return exactly one user-facing final reply. Do not call channels_messages_post for ${conversationId}; Chief publishes your returned reply to that conversation. Use channels_reactions_add sparingly when a reaction is more natural than another acknowledgement, never on your own message, and at most once per user message.`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    await activityPublisher.flush();
    if (agentSession.sessionId) {
      await cell.writeState(
        `providerSession:${sessionKey}`,
        agentSession.sessionId,
      );
    }
    await cell.writeState(
      `events:${sessionKey}`,
      agentSession.events.slice(-500),
    );
    const reply = finalAssistantText(turnEvents) ?? "Work completed.";
    await agentSession.stop();
    session = null;
    await client.completeAgentJob(agentId, {
      leaseToken: lease.leaseToken,
      outcome: {
        status: "completed",
        result:
          job.kind === "workspace.onboarding"
            ? {
                openingMessage:
                  "Hey, welcome to Chief 👋 I'm getting the team oriented around your business. What would make the biggest difference this month: shipping something in your product, reaching more customers, or another outcome? Tell me what's getting in the way, and we'll turn it into a focused plan while the team researches your business.",
              }
            : postedFinalToOrigin(
                  turnEvents,
                  conversationId,
                  activityContext.threadRootId,
                )
              ? {}
              : {
                  publishedMessage: {
                    conversationId,
                    ...(activityContext.threadRootId
                      ? { threadRootId: activityContext.threadRootId }
                      : undefined),
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
    activityPublisher.recordFailure(
      error instanceof Error ? error.message : String(error),
    );
    await activityPublisher
      .flush()
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
        ...(error instanceof LocalJobBlockedError ? undefined : { retryAt }),
      },
    });
    throw error;
  } finally {
    await session
      ?.stop()
      .catch((error) => console.error("[cell] session stop:", error));
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
    await executeJob(cell, client, config, lease).catch((error) => {
      console.error("[cell] job failed:", error);
    });
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
      if (config.inference.provider === "codex") await ensureCodexSetup();
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
        const poll = setInterval(() => {
          void drain().catch((error) =>
            console.error("[cell] mailbox poll:", error),
          );
          if (socket.readyState === WebSocket.OPEN) socket.ping();
        }, 30_000);
        socket.on("close", () => {
          clearInterval(poll);
          resolve();
        });
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

async function smokeLocalStore() {
  const cellRoot = requiredEnvironment("CHIEF_CELL_ROOT");
  mkdirSync(cellRoot, { recursive: true, mode: 0o700 });
  const store = new LocalStore(join(cellRoot, "cell.sqlite"));
  await store.health();
  await store.close();
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
} else if (mode === "smoke") {
  await smokeLocalStore();
} else {
  healthEndpoint();
  await listenForJobs();
}
