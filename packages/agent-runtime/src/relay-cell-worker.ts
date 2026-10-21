import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import WebSocket from "ws";

import type { AgentConfig, AgentJob } from "@chief/relay-contracts";
import {
  createNip98Authorization,
  RelayClient,
  RelayClientError,
} from "@chief/relay-client";
import {
  agentAttachmentSchema,
  agentConfigSchema,
  attachmentLocation,
  parseJsonObject,
  parseJsonString,
} from "@chief/relay-contracts";

import type { AgentEvent, DriverType, MessageAttachment } from "./types.js";
import { agentSkillById } from "./agent-skills.js";
import { DesktopAgentCell } from "./cells/desktop-cell.js";
import { ensureCodexSetup } from "./drivers/codex-install.js";
import { LocalStore } from "./local-store.js";
import { PluginRuntime } from "./plugins/runtime.js";
import {
  localCellExecutionContext,
  localCellInstructions,
} from "./prompts/local-cell.js";
import { relayCellHostInstructions } from "./prompts/relay-cell-tool-binding.js";
import {
  activeSkillInstructions,
  relayCellFinalReply,
  relayCellWorkspaceContext,
} from "./prompts/relay-cell-turn.js";
import { RelayActivityPublisher } from "./relay-activity-publisher.js";
import { cellAgentDefinition } from "./relay-cell-agent.js";
import {
  APPROVAL_WAIT_MS,
  approvalGranted,
  approvalSummary,
  askForApproval,
} from "./relay-cell-approvals.js";
import { LocalJobBlockedError, localJobProject } from "./relay-cell-project.js";
import { instructionOf, RunSteering } from "./relay-cell-steering.js";
import {
  isRelayPluginToolName,
  relayCellToolNames,
  runRelayCellMcpServer,
  startRelayCellMcpHttpServer,
} from "./relay-cell-tools.js";
import { attachmentPromptContext } from "./session-prompt-context.js";
import { AgentSession } from "./session.js";

const mode = process.argv[2] ?? "worker";
const plugins = new PluginRuntime(() => undefined);

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

function socketEvent(data: Buffer) {
  try {
    return parseJsonObject(JSON.parse(String(data)));
  } catch {
    return undefined;
  }
}

/** The thread run in progress, which a new message to it steers. */
let steering: RunSteering | null = null;

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
  try {
    await cell.leasesManager.acquire(cell.id, {
      runId,
      agentId,
      ttlMs: 5 * 60_000,
    });
  } catch (error) {
    // Hand the job straight back rather than leaving it leased until expiry.
    await client.completeAgentJob(agentId, {
      leaseToken: lease.leaseToken,
      outcome: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        retryAt: new Date(Date.now() + 30_000).toISOString(),
      },
    });
    throw error;
  }
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
    const cellDirectory =
      project?.directory ?? requiredEnvironment("CHIEF_CELL_ROOT");
    const executionContext = {
      workingDirectory: cellDirectory,
      homeDirectory: homedir(),
      project,
    };
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
        instructions: localCellInstructions({
          identity: [
            definition.instructions,
            relayCellHostInstructions,
            activeSkill
              ? activeSkillInstructions(activeSkill.instructions)
              : undefined,
          ]
            .filter(Boolean)
            .join("\n\n"),
          permissions: config.toolPermissions,
          conversationKind: conversationId.startsWith("dm-")
            ? "direct"
            : "channel",
          workspaceContext: relayCellWorkspaceContext(job.payload, agentId),
          ...executionContext,
        }),
      },
      conversationId,
      {
        driver: normalizeDriver(config.inference.provider),
        // With automatic approvals the agent works freely on this device;
        // otherwise Chief's own tools run and anything else is asked of the
        // person in the thread below.
        access: config.approvals === "auto" ? "full" : "guarded",
        workspaceId: job.workspaceId,
        model:
          config.inference.model.toLowerCase() === "auto"
            ? undefined
            : config.inference.model,
        mcpServers: [
          relayMcp.spec,
          // Remote plugins belong to the workspace and reach this agent
          // through the relay, which enforces assignment and approvals. Only
          // plugins that run on this device attach directly.
          ...(await plugins.mcpServers(job.workspaceId)).filter(
            (server) => server.command !== "",
          ),
        ],
        maxPromptAttempts: 3,
      },
      priorEvents,
    );
    session = agentSession;
    // What the agent wasn't allowed to do, so the run can say so.
    const refused: string[] = [];
    // Anything else is the person's call. In a conversation they're asked in
    // the thread and the run waits for their answer; a run nobody is
    // watching, such as an automation step, is refused.
    const decidePermission = async (
      event: Extract<AgentEvent, { type: "permission" }>,
    ) => {
      const waiting = steering;
      if (!waiting) return false;
      try {
        await askForApproval(client, {
          workspaceId: job.workspaceId,
          agentId,
          conversationId,
          ...(activityContext.threadRootId
            ? { threadRootId: activityContext.threadRootId }
            : undefined),
          requestId: event.requestId,
          toolName: event.toolName,
          toolInput: event.input,
        });
        return approvalGranted(await waiting.awaitAnswer(APPROVAL_WAIT_MS));
      } catch (error) {
        console.error("[cell] approval:", error);
        return false;
      }
    };
    agentSession.on("event", (event: AgentEvent) => {
      turnEvents.push(event);
      activityPublisher.accept(event);
      if (event.type === "permission") {
        const tool = event.toolName.toLowerCase();
        // Plugin calls go through the relay, which refuses writes for an
        // agent that asks before acting.
        const allow =
          (tool.startsWith("mcp__chief_relay__") ||
            tool.startsWith("mcp.chief_relay.")) &&
          isRelayPluginToolName(tool)
            ? true
            : relayCellToolNames.some(
                (name) =>
                  tool === name ||
                  tool === `mcp__chief_relay__${name}` ||
                  tool === `mcp.chief_relay.${name}`,
              );
        if (allow) {
          agentSession.respondPermission(event.requestId, "allow");
          return;
        }
        void decidePermission(event).then((granted) => {
          if (!granted)
            refused.push(approvalSummary(event.toolName, event.input).action);
          agentSession.respondPermission(
            event.requestId,
            granted ? "allow" : "deny",
          );
        });
      }
      void cell
        .writeState(`events:${sessionKey}`, agentSession.events.slice(-500))
        .catch((error) => console.error("[cell] event persistence:", error));
    });
    mkdirSync(cellDirectory, { recursive: true, mode: 0o700 });
    await agentSession.start(
      cellDirectory,
      parseJsonString(await cell.readState(`providerSession:${sessionKey}`)),
    );
    const promptContext = {
      threadRootId: activityContext.threadRootId,
      privateInstructions: [
        relayCellWorkspaceContext(job.payload, agentId),
        localCellExecutionContext(executionContext),
        job.kind === "conversation.message" || job.kind === "schedule.step"
          ? relayCellFinalReply(conversationId, activityContext.threadRootId)
          : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
    if (job.kind === "conversation.message") {
      steering = new RunSteering(
        conversationId,
        activityContext.threadRootId,
        client,
        agentId,
        `${agentId}-${process.pid}`,
        () => session,
        // A message sent mid-run brings its images as files the agent reads.
        async (steered) =>
          [
            instructionOf(steered),
            await attachmentPromptContext(
              cellDirectory,
              await jobAttachments(client, steered.job, conversationId),
            ),
          ]
            .filter(Boolean)
            .join("\n\n"),
      );
    }
    await agentSession.sendPrompt(instruction, job.id, false, {
      ...promptContext,
      attachments: await jobAttachments(client, job, conversationId),
    });
    await steering?.drain((text, jobId) =>
      agentSession.sendPrompt(text, jobId, false, promptContext),
    );
    steering = null;
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
    const reply = finalAssistantText(turnEvents);
    const posted = postedFinalToOrigin(
      turnEvents,
      conversationId,
      activityContext.threadRootId,
    );
    // A run that ends without a word hasn't done what was asked; it fails
    // and says why rather than claiming it finished.
    if (!reply && !posted && job.kind !== "workspace.onboarding")
      throw new LocalJobBlockedError(
        refused.length
          ? `Stopped without finishing: it wasn't allowed to ${[...new Set(refused)].join(", ")}.`
          : "Stopped without replying.",
      );
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
            : posted || !reply
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
    steering = null;
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
  // This process is the cell's only worker, so a run lease still on disk was
  // left by a previous process that exited mid-run.
  await cell.leasesManager.expireStale(Number.MAX_SAFE_INTEGER);
  let draining: Promise<void> | null = null;
  const drain = () => {
    draining ??= drainMailbox(cell, client, config).finally(() => {
      draining = null;
    });
    return draining;
  };
  const settled = async () => await draining?.catch(() => undefined);

  // Each failed connection waits twice as long as the last. After ten in a row
  // the cell exits rather than poll a relay that is down; the desktop starts it
  // again the next time it loads the workspace.
  let delay = 1_000;
  let failures = 0;
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
          failures = 0;
          void drain().catch((error) => console.error("[cell] job:", error));
        });
        socket.on("message", (data: Buffer) => {
          // A message for the thread this cell is running steers that run.
          const ping = parseJsonObject(socketEvent(data)?.payload);
          const jobId = parseJsonString(ping?.jobId);
          if (
            jobId &&
            steering &&
            ping?.conversationId === steering.conversationId &&
            (parseJsonString(ping.threadRootId) ?? undefined) ===
              steering.threadRootId
          ) {
            steering.admit(jobId);
            return;
          }
          void drain().catch((error) => console.error("[cell] job:", error));
        });
        // The relay pushes every job that becomes claimable, including delayed
        // jobs and expired leases, so claims follow socket messages. The slow
        // drain only covers a push lost on a socket that died silently.
        const keepAlive = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.ping();
        }, 30_000);
        const fallback = setInterval(() => {
          void drain().catch((error) =>
            console.error("[cell] mailbox poll:", error),
          );
        }, 300_000);
        socket.on("close", () => {
          clearInterval(keepAlive);
          clearInterval(fallback);
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
    if (++failures >= 10) {
      await settled();
      console.error("[cell] relay unreachable, stopping");
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 300_000);
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

/**
 * The images a job's message carried, read through the relay as this agent
 * so the relay checks it can still see the conversation. An image that can't
 * be read is left out rather than failing the run.
 */
async function jobAttachments(
  client: RelayClient,
  job: AgentJob,
  conversationId: string,
): Promise<MessageAttachment[]> {
  const parsed = agentAttachmentSchema
    .array()
    .max(8)
    .safeParse(job.payload.attachments ?? []);
  if (!parsed.success) return [];
  const read = await Promise.all(
    parsed.data.map(async (attachment) => {
      if (attachmentLocation(attachment.url)?.conversationId !== conversationId)
        return [];
      try {
        const { bytes, mediaType } = await client.downloadAttachment(
          attachment.url,
        );
        return [
          {
            name: attachment.name,
            mediaType,
            url: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
          },
        ];
      } catch (error) {
        console.error("[cell] attachment:", error);
        return [];
      }
    }),
  );
  return read.flat();
}
