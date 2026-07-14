import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { SessionManager } from "./manager.js";
import {
  composeWorkspaceInstructions,
  defaultAgents,
  getAgent,
} from "./agents.js";
import { ensureExecutorWorkspace } from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import { listModels } from "./models.js";
import { handleLocalTool, localToolsOpenApi } from "./local-tools.js";
import {
  availableCapabilities,
  composeAgentCapabilities,
} from "./capabilities/index.js";
import type {
  ClientMessage,
  ExecutorCapability,
  InputRequest,
  ServerMessage,
} from "./types.js";
import { workspaceRoot, workspaceSecrets } from "./workspace-secrets.js";
import {
  readWorkspaceContext,
  writeWorkspaceContext,
} from "./workspace-context.js";
import { createChiefMcpHandler } from "./mcp-server.js";
import { loadSlackGatewayConfig } from "./channels/slack-config.js";
import { SlackGateway } from "./channels/slack-gateway.js";
import { RecurringWorkScheduler } from "./scheduler.js";
import { nextRunAt, validateCron } from "./recurring-work.js";

/**
 * Stores submitted values per each field's save target and returns
 * human-readable destinations for the agent (never the values themselves).
 */
async function storeInputValues(
  workspaceId: string,
  request: InputRequest,
  values: Record<string, string>,
): Promise<string[]> {
  const saved: string[] = [];
  for (const field of request.fields) {
    const value = values[field.key];
    if (typeof value !== "string" || value.length === 0) continue;
    if ("file" in field.save) {
      saved.push(
        await workspaceSecrets.storeFile(workspaceId, field.save.file, value),
      );
    } else {
      await workspaceSecrets.storeEnv(workspaceId, field.save.envKey, value);
      saved.push(`${field.save.envKey} in this workspace's Keychain vault`);
    }
  }
  await workspaceSecrets.refresh(workspaceId);
  return saved;
}

const PORT = Number(process.env.CHIEF_RUNTIME_PORT ?? 4318);

/**
 * The agent service. Binds loopback-only; clients (desktop app today,
 * Slack/Discord bridges or a phone via tunnel later) speak the same JSON
 * protocol. Designed to run anywhere node runs — laptop, Raspberry Pi.
 */
export function startServer(port = PORT) {
  const manager = new SessionManager();
  const localCapabilities = new Map<string, string>();
  const authorizeWorkspace = async (
    workspaceId: string,
    capability: ExecutorCapability,
  ) => {
    const cachedWorkspace = localCapabilities.get(capability.token);
    if (cachedWorkspace) {
      if (cachedWorkspace !== workspaceId) {
        throw new Error("Workspace capability does not match this workspace.");
      }
      return;
    }

    const url = new URL("/agent-tools/whoami", capability.apiBaseUrl);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      throw new Error("Workspace capability endpoint must use HTTPS.");
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${capability.token}` },
    });
    const body = (await response.json().catch(() => null)) as {
      organizationId?: string;
    } | null;
    if (!response.ok || body?.organizationId !== workspaceId) {
      throw new Error("Could not verify access to this workspace.");
    }
    localCapabilities.set(capability.token, workspaceId);
    void ensureSlackGateway(workspaceId);
  };

  // Local Slack gateways: one Socket Mode connection per workspace that has
  // enabled Slack and stored its tokens. Started lazily on first workspace
  // authorization; config changes apply on the next runtime start.
  const slackGateways = new Map<string, SlackGateway>();
  const slackAttempted = new Set<string>();
  const ensureSlackGateway = async (workspaceId: string) => {
    if (slackAttempted.has(workspaceId)) return;
    slackAttempted.add(workspaceId);
    try {
      const config = await loadSlackGatewayConfig(workspaceId);
      if (!config) return;
      const gateway = new SlackGateway(manager, config);
      await gateway.start();
      slackGateways.set(workspaceId, gateway);
      console.log(`[slack] gateway connected for workspace ${workspaceId}`);
    } catch (error) {
      console.error("[slack] gateway failed to start:", error);
    }
  };

  let broadcastWorkspaceData = async (_workspaceId: string) => {};
  let broadcastNotice = (
    _workspaceId: string,
    _notice: import("./types.js").RuntimeNotice,
  ) => {};
  const scheduler = new RecurringWorkScheduler(
    manager,
    (workspaceId) => broadcastWorkspaceData(workspaceId),
    (workspaceId, notice) => broadcastNotice(workspaceId, notice),
  );
  // Bind both loopback families — macOS clients resolving "localhost" may
  // dial ::1 or 127.0.0.1. Never bind non-loopback interfaces here.
  const handler = async (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => {
    const path = req.url
      ? new URL(req.url, `http://127.0.0.1:${port}`).pathname
      : "/";
    if (req.method === "GET" && path === "/local-tools/openapi.json") {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(localToolsOpenApi(`http://127.0.0.1:${port}`)));
      return;
    }
    if (path.startsWith("/local-tools/")) {
      const authorization = req.headers.authorization ?? "";
      const token = authorization.match(/^Bearer (.+)$/)?.[1];
      const workspaceId = token ? localCapabilities.get(token) : undefined;
      if (!workspaceId) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).flatMap(([key, value]) =>
            typeof value === "string" ? [[key, value]] : [],
          ),
        ),
        ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await handleLocalTool(request, workspaceId, manager);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      if (req.method === "POST" && response.ok) {
        void broadcastWorkspaceData(workspaceId);
        if (path === "/local-tools/attention") {
          broadcastNotice(workspaceId, {
            kind: "attention",
            title: "An agent flagged something for you",
          });
        }
      }
      return;
    }
    if (await handleMcp(req, res)) return;
    res.writeHead(204, { "access-control-allow-origin": "*" });
    res.end();
  };
  const handleMcp = createChiefMcpHandler({
    manager,
    authorize: authorizeWorkspace,
  });
  const http4 = createServer(handler);
  const http6 = createServer(handler);
  const wss = new WebSocketServer({ server: http4 });
  const wss6 = new WebSocketServer({ server: http6 });
  http4.listen(port, "127.0.0.1");
  http6.listen(port, "::1");
  http6.on("error", () => {});
  wss6.on("connection", (ws, req) => wss.emit("connection", ws, req));
  wss6.on("error", () => {});
  broadcastWorkspaceData = async (workspaceId) => {
    const data = await manager.workspaceData(workspaceId);
    const message = JSON.stringify({
      type: "workspaceData",
      workspaceId,
      ...data,
    });
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  };
  broadcastNotice = (workspaceId, notice) => {
    const message = JSON.stringify({
      type: "runtimeNotice",
      workspaceId,
      notice,
    });
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  };

  wss.on("connection", (ws, req) => {
    console.log(`[chief] client connected (${req.socket.remoteAddress})`);
    ws.on("close", () => console.log("[chief] client disconnected"));
    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    const subscriptions = new Set<string>();
    const sessionListeners = new Map<
      string,
      {
        session: Awaited<ReturnType<typeof manager.ensure>>;
        listener: (event: unknown) => void;
      }
    >();

    ws.on("message", async (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return send({ type: "error", message: "invalid JSON" });
      }

      try {
        switch (msg.type) {
          case "listAgents":
            send({ type: "agents", agents: defaultAgents });
            break;

          case "listModels":
            send({
              type: "models",
              driver: msg.driver,
              models: await listModels(msg.driver),
            });
            break;

          case "listWorkspaceData":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send({
              type: "workspaceData",
              workspaceId: msg.workspaceId,
              ...(await manager.workspaceData(msg.workspaceId)),
            });
            break;

          case "bootstrapOnboardingWork": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            if (msg.workspaceContext?.trim()) {
              writeWorkspaceContext(
                msg.workspaceId,
                msg.workspaceContext.slice(0, 40_000),
              );
            }
            const now = Date.now();
            const jobs = msg.jobs.slice(0, 8);
            for (const job of jobs) {
              if (!/^[a-z0-9][a-z0-9_-]{2,96}$/i.test(job.id)) {
                throw new Error("Invalid onboarding job id.");
              }
              const runAt = Math.max(job.runAt, now + 60_000);
              let instructions = job.instructions.trim().slice(0, 40_000);
              const attachments = (job.attachments ?? []).slice(0, 4);
              if (attachments.length > 0) {
                const directory = join(
                  workspaceRoot(msg.workspaceId),
                  "onboarding",
                  job.id,
                );
                mkdirSync(directory, { recursive: true, mode: 0o700 });
                const saved: string[] = [];
                let totalBytes = 0;
                for (const attachment of attachments) {
                  const match = /^data:[^;]+;base64,(.+)$/.exec(
                    attachment.dataUrl,
                  );
                  if (!match) continue;
                  const bytes = Buffer.from(match[1]!, "base64");
                  totalBytes += bytes.byteLength;
                  if (totalBytes > 6 * 1024 * 1024) {
                    throw new Error("Onboarding attachments exceed 6 MB.");
                  }
                  const safeName = basename(attachment.name).replace(
                    /[^a-zA-Z0-9._-]+/g,
                    "-",
                  );
                  const path = join(directory, safeName || "brand-file");
                  writeFileSync(path, bytes, { mode: 0o600 });
                  saved.push(path);
                }
                if (saved.length > 0) {
                  instructions += `\n\nFiles supplied during onboarding:\n${saved.map((path) => `- ${path}`).join("\n")}`;
                }
              }
              const toolPatterns = Array.from(
                new Set(
                  job.proposedToolPatterns
                    .filter((pattern) => pattern.startsWith("tools."))
                    .slice(0, 24),
                ),
              );
              const existing = await manager.recurringWorkById(
                msg.workspaceId,
                job.id,
              );
              await manager.saveRecurringWork(msg.workspaceId, {
                id: job.id,
                agentId: job.agentId,
                title: job.title.trim().slice(0, 160),
                instructions,
                cron: "0 0 1 1 *",
                timezone: job.timezone,
                runOnceAt: runAt,
                status: "active",
                placement: "local",
                approvalSummary:
                  "Approved during onboarding and queued to run after setup completes.",
                proposedToolPatterns: toolPatterns,
                grant: {
                  version: 1,
                  approvedAt: now,
                  toolPatterns,
                },
                nextRunAt: runAt,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
              });
            }
            for (const schedule of (msg.schedules ?? []).slice(0, 8)) {
              if (!/^[a-z0-9][a-z0-9_-]{2,96}$/i.test(schedule.id)) {
                throw new Error("Invalid onboarding schedule id.");
              }
              validateCron(schedule.cron, schedule.timezone);
              const existing = await manager.recurringWorkById(
                msg.workspaceId,
                schedule.id,
              );
              const toolPatterns = Array.from(
                new Set(
                  schedule.proposedToolPatterns
                    .filter((pattern) => pattern.startsWith("tools."))
                    .slice(0, 24),
                ),
              );
              await manager.saveRecurringWork(msg.workspaceId, {
                id: schedule.id,
                agentId: schedule.agentId,
                title: schedule.title.trim().slice(0, 160),
                instructions: schedule.instructions.trim().slice(0, 40_000),
                cron: schedule.cron,
                timezone: schedule.timezone,
                status: schedule.status,
                placement: "local",
                approvalSummary: schedule.approvalSummary
                  .trim()
                  .slice(0, 2_000),
                proposedToolPatterns: toolPatterns,
                grant:
                  schedule.status === "active"
                    ? { version: 1, approvedAt: now, toolPatterns }
                    : undefined,
                nextRunAt:
                  schedule.status === "active"
                    ? nextRunAt(schedule.cron, schedule.timezone)
                    : undefined,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
              });
            }
            await broadcastWorkspaceData(msg.workspaceId);
            send({
              type: "onboardingWorkBootstrapped",
              workspaceId: msg.workspaceId,
            });
            break;
          }

          case "saveCampaign":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.saveCampaign(msg.workspaceId, msg.campaign);
            await broadcastWorkspaceData(msg.workspaceId);
            break;

          case "saveRecurringWork": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            validateCron(msg.work.cron, msg.work.timezone);
            const existing = await manager.recurringWorkById(
              msg.workspaceId,
              msg.work.id,
            );
            if (!existing) {
              throw new Error(
                "Recurring work must be proposed by an agent first.",
              );
            }
            if (msg.work.grant) {
              const proposed = new Set(existing.proposedToolPatterns);
              if (
                msg.work.grant.toolPatterns.some(
                  (pattern) => !proposed.has(pattern),
                )
              ) {
                throw new Error(
                  "Approval contains tools the agent did not propose.",
                );
              }
            }
            const active = msg.work.status === "active";
            const now = Date.now();
            const missedOneOff =
              active &&
              existing.runOnceAt !== undefined &&
              existing.runOnceAt <= now;
            if (active && !msg.work.grant) {
              throw new Error(
                "Explicit approval is required before activation.",
              );
            }
            // The client may edit scheduling and presentation; instructions
            // and proposed tool patterns stay agent-authored and the grant is
            // validated above, so the delegation can never widen silently.
            await manager.saveRecurringWork(msg.workspaceId, {
              ...existing,
              title: msg.work.title,
              cron: msg.work.cron,
              timezone: msg.work.timezone,
              placement: msg.work.placement,
              skipDates: msg.work.skipDates,
              status: msg.work.status,
              grant: msg.work.grant,
              nextRunAt: active
                ? missedOneOff
                  ? now
                  : (existing.runOnceAt ??
                    nextRunAt(msg.work.cron, msg.work.timezone))
                : msg.work.nextRunAt,
              updatedAt: now,
            });
            if (active) {
              // Approving IS the action the attention item asked for — the
              // app knows the user acted; never make them dismiss it too.
              for (const suffix of ["approval", "needs_approval", "failed"]) {
                await manager.dismissAttentionItem(
                  msg.workspaceId,
                  `attention-${msg.work.id}-${suffix}`,
                );
              }
            }
            await broadcastWorkspaceData(msg.workspaceId);
            if (missedOneOff) {
              void scheduler
                .runNow(msg.workspaceId, msg.work.id)
                .catch((error) => console.error("[recurring-work]", error));
            }
            break;
          }

          case "runRecurringWorkNow":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            void scheduler
              .runNow(msg.workspaceId, msg.recurringWorkId)
              .catch((error) => console.error("[recurring-work]", error));
            break;

          case "dismissAttentionItem":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.dismissAttentionItem(
              msg.workspaceId,
              msg.attentionItemId,
            );
            await broadcastWorkspaceData(msg.workspaceId);
            break;

          case "expandRecurringWorkGrant": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const work = await manager.recurringWorkById(
              msg.workspaceId,
              msg.recurringWorkId,
            );
            if (!work?.grant) {
              throw new Error("Only approved automations can be widened.");
            }
            const blocked = await manager.latestRunBlockedTools(
              msg.workspaceId,
              msg.recurringWorkId,
            );
            const addTools = [...new Set(msg.addTools)];
            const valid =
              addTools.length > 0 &&
              addTools.every(
                (address) =>
                  /^tools\.[A-Za-z0-9_.-]+$/.test(address) &&
                  blocked.includes(address),
              );
            if (!valid) {
              throw new Error(
                "Only tools a run was actually blocked on can be allowed.",
              );
            }
            await manager.saveRecurringWork(msg.workspaceId, {
              ...work,
              nextRunAt:
                work.runOnceAt === undefined
                  ? nextRunAt(work.cron, work.timezone)
                  : msg.rerun
                    ? Date.now()
                    : undefined,
              proposedToolPatterns: [
                ...new Set([...work.proposedToolPatterns, ...addTools]),
              ],
              // The user clicked a button naming these exact addresses —
              // that is the explicit re-approval this widening requires.
              grant: {
                ...work.grant,
                approvedAt: Date.now(),
                toolPatterns: [
                  ...new Set([...work.grant.toolPatterns, ...addTools]),
                ],
              },
              status:
                work.runOnceAt !== undefined && !msg.rerun
                  ? "paused"
                  : "active",
              updatedAt: Date.now(),
            });
            for (const suffix of ["approval", "needs_approval", "failed"]) {
              await manager.dismissAttentionItem(
                msg.workspaceId,
                `attention-${msg.recurringWorkId}-${suffix}`,
              );
            }
            await broadcastWorkspaceData(msg.workspaceId);
            if (msg.rerun) {
              void scheduler
                .runNow(msg.workspaceId, msg.recurringWorkId)
                .catch((error) => console.error("[recurring-work]", error));
            }
            break;
          }

          case "deleteRecurringWork":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.deleteRecurringWork(
              msg.workspaceId,
              msg.recurringWorkId,
            );
            // Rejecting is also an action: clear anything it was flagged for.
            for (const suffix of ["approval", "needs_approval", "failed"]) {
              await manager.dismissAttentionItem(
                msg.workspaceId,
                `attention-${msg.recurringWorkId}-${suffix}`,
              );
            }
            await broadcastWorkspaceData(msg.workspaceId);
            break;

          case "deleteRecurringWorkRun":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.deleteRecurringWorkRun(msg.workspaceId, msg.runId);
            await broadcastWorkspaceData(msg.workspaceId);
            break;

          case "listAgentPreferences":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send({
              type: "agentPreferences",
              workspaceId: msg.workspaceId,
              preferences: await manager.listAgentPreferences(msg.workspaceId),
            });
            break;

          case "saveAgentPreference":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.saveAgentPreference(msg.workspaceId, msg.preference);
            send({
              type: "agentPreferences",
              workspaceId: msg.workspaceId,
              preferences: await manager.listAgentPreferences(msg.workspaceId),
            });
            break;

          case "setChatPreferences":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.updateChatPreferences(
              msg.workspaceId,
              msg.chatId,
              msg.driver,
              msg.model,
            );
            send({
              type: "chats",
              workspaceId: msg.workspaceId,
              chats: await manager.listChats(msg.workspaceId),
            });
            break;

          case "listChats":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send({
              type: "chats",
              workspaceId: msg.workspaceId,
              chats: await manager.listChats(msg.workspaceId),
            });
            break;

          case "observeSession": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const session = manager.get(msg.chatId);
            if (
              !session ||
              session.agent.id !== msg.agentId ||
              session.config.workspaceId !== msg.workspaceId
            ) {
              return send({
                type: "error",
                message: "This scheduled run is no longer active.",
                chatId: msg.chatId,
              });
            }
            if (!subscriptions.has(msg.chatId)) {
              subscriptions.add(msg.chatId);
              manager.retain(msg.chatId);
              const chatId = msg.chatId;
              const listener = (event: unknown) => {
                send({
                  type: "event",
                  chatId,
                  event: event as import("./types.js").AgentEvent,
                });
              };
              session.on("event", listener);
              sessionListeners.set(chatId, { session, listener });
            }
            send({
              type: "sessionOpened",
              chatId: msg.chatId,
              agentId: msg.agentId,
            });
            send({
              type: "history",
              chatId: msg.chatId,
              events: session.events,
            });
            break;
          }

          case "openSession": {
            const agent = getAgent(msg.agentId);
            if (!agent) {
              return send({
                type: "error",
                message: `unknown agent: ${msg.agentId}`,
                chatId: msg.chatId,
              });
            }
            // The runtime never picks a provider itself — the client resolves
            // the workspace's choice and must send it.
            if (!msg.driver) {
              return send({
                type: "error",
                message: "no provider configured for this chat",
                chatId: msg.chatId,
              });
            }
            if (msg.workspaceId) {
              if (!msg.executorCapability) {
                throw new Error("Workspace authorization is required.");
              }
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            }
            // Workspace tools are additive: a control-plane failure here must
            // degrade the session to no executor tools, not block chat.
            const executorWorkspace =
              agent.id !== "setup" && msg.workspaceId && msg.executorCapability
                ? await ensureExecutorWorkspace(
                    msg.workspaceId,
                    msg.executorCapability,
                  ).catch((error: unknown) => {
                    console.error(
                      `[runtime] Executor workspace unavailable for ${msg.chatId}:`,
                      error,
                    );
                    return null;
                  })
                : null;
            const capableAgent = msg.capabilities
              ? composeAgentCapabilities(
                  agent,
                  availableCapabilities.filter((capability) =>
                    msg.capabilities!.includes(capability.id),
                  ),
                )
              : agent;
            const integratedAgent =
              msg.integrations !== undefined
                ? {
                    ...capableAgent,
                    instructions: `${capableAgent.instructions}\n\nAssigned integrations: ${msg.integrations.length > 0 ? msg.integrations.join(", ") : "none"}. Only search for and call integration tools from this assigned set.`,
                  }
                : capableAgent;
            // Prime the session with the workspace's brand context and the
            // shared operating rules, and persist the context so unattended
            // recurring runs open with the same grounding.
            const workspaceContext =
              msg.workspaceContext ??
              (msg.workspaceId
                ? readWorkspaceContext(msg.workspaceId)
                : undefined);
            if (msg.workspaceId && msg.workspaceContext) {
              writeWorkspaceContext(msg.workspaceId, msg.workspaceContext);
            }
            const effectiveAgent = {
              ...integratedAgent,
              instructions: composeWorkspaceInstructions(
                integratedAgent.instructions,
                workspaceContext,
              ),
            };
            const session = await manager.ensure(effectiveAgent, msg.chatId, {
              driver: msg.driver,
              access: msg.access ?? "guarded",
              workspaceId: msg.workspaceId ?? "local",
              model: msg.model,
              mcpServers: executorWorkspace
                ? [executorToolServer(executorWorkspace)]
                : [],
            });
            if (!subscriptions.has(msg.chatId)) {
              subscriptions.add(msg.chatId);
              manager.retain(msg.chatId);
              const chatId = msg.chatId;
              const listener = async (event: unknown) => {
                const agentEvent = event as import("./types.js").AgentEvent;
                send({ type: "event", chatId, event: agentEvent });
                if (
                  agentEvent.type === "message" &&
                  agentEvent.role === "user" &&
                  msg.workspaceId
                ) {
                  await manager.waitForChatPersistence(chatId);
                  send({
                    type: "chats",
                    workspaceId: msg.workspaceId,
                    chats: await manager.listChats(msg.workspaceId),
                  });
                }
              };
              session.on("event", listener);
              sessionListeners.set(chatId, { session, listener });
            }
            send({
              type: "sessionOpened",
              chatId: msg.chatId,
              agentId: agent.id,
            });
            // Replay the buffered transcript so navigating away and back (or
            // reconnecting mid-run) resumes instead of presenting a fresh chat.
            send({
              type: "history",
              chatId: msg.chatId,
              events: session.events,
            });
            break;
          }

          case "closeSession":
            if (subscriptions.delete(msg.chatId)) {
              const registered = sessionListeners.get(msg.chatId);
              if (registered) {
                registered.session.off("event", registered.listener);
                sessionListeners.delete(msg.chatId);
              }
              await manager.release(msg.chatId);
            }
            break;

          case "deleteSession":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            subscriptions.delete(msg.chatId);
            {
              const registered = sessionListeners.get(msg.chatId);
              if (registered) {
                registered.session.off("event", registered.listener);
                sessionListeners.delete(msg.chatId);
              }
            }
            await manager.remove(msg.workspaceId, msg.chatId);
            send({
              type: "chats",
              workspaceId: msg.workspaceId,
              chats: await manager.listChats(msg.workspaceId),
            });
            break;

          case "prompt": {
            const session = manager.get(msg.chatId);
            if (!session) {
              return send({
                type: "error",
                message:
                  "No session for this chat yet. Reopen it to reconnect.",
                chatId: msg.chatId,
              });
            }
            await session.sendPrompt(msg.text);
            break;
          }

          case "interrupt":
            await manager.get(msg.chatId)?.interrupt();
            break;

          case "respondPermission":
            manager
              .get(msg.chatId)
              ?.respondPermission(msg.requestId, msg.behavior);
            break;

          case "respondQuestion":
            manager
              .get(msg.chatId)
              ?.respondQuestion(msg.requestId, msg.answers);
            break;

          case "queryInputs": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const present = (
              await workspaceSecrets.keys(msg.workspaceId)
            ).filter((key) => msg.keys.includes(key));
            send({
              type: "inputsStatus",
              workspaceId: msg.workspaceId,
              present,
            });
            break;
          }

          case "storeInput": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await storeInputValues(msg.workspaceId, msg.request, msg.values);
            send({
              type: "inputsStatus",
              workspaceId: msg.workspaceId,
              present: await workspaceSecrets.keys(msg.workspaceId),
            });
            break;
          }

          case "provideInput": {
            const session = manager.get(msg.chatId);
            if (!session) {
              return send({
                type: "error",
                message:
                  "No session for this chat yet. Reopen it to reconnect.",
                chatId: msg.chatId,
              });
            }
            const saved = await storeInputValues(
              session.config.workspaceId,
              msg.request,
              msg.values,
            );
            await session.sendPrompt(
              saved.length > 0
                ? `Provided: ${msg.request.title}. Saved to: ${saved.join(", ")}. Read the values from there when commands need them; never print them. Continue the setup.`
                : `Provided: ${msg.request.title}, but no values were saved. Ask again with clearer fields if you still need them.`,
            );
            break;
          }
        }
      } catch (err) {
        send({
          type: "error",
          message: String(err instanceof Error ? err.message : err),
          chatId: "chatId" in msg ? msg.chatId : undefined,
        });
      }
    });

    ws.on("close", () => {
      for (const chatId of subscriptions) {
        const registered = sessionListeners.get(chatId);
        if (registered) registered.session.off("event", registered.listener);
        void manager.release(chatId);
      }
      sessionListeners.clear();
      subscriptions.clear();
    });
  });

  // The scheduler dispatches approved unattended work, so only the process
  // that actually owns the port may run it — a second runtime (stale watcher,
  // installed app next to dev) polling the same database must stay passive.
  http4.on("listening", () => {
    console.log(`[chief] agent runtime listening on ws://127.0.0.1:${port}`);
    scheduler.start();
  });
  http4.on("error", (error) => {
    console.error(
      `[chief] could not bind port ${port} (another runtime running?); scheduler stays off:`,
      error,
    );
  });

  const shutdown = async () => {
    scheduler.stop();
    await Promise.all(
      [...slackGateways.values()].map((gateway) =>
        gateway.stop().catch(() => {}),
      ),
    );
    await manager.stopAll();
    wss.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return wss;
}

startServer();
