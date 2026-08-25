import { Workspace } from "@cloudflare/computer";
import { createGitClient } from "@cloudflare/computer/git";
import { DurableObject } from "cloudflare:workers";

import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import { agentCellSnapshotSchema, agentIdSchema } from "@chief/relay-contracts";

import {
  exportComputerFiles,
  importComputerFiles,
} from "./agent-computer-snapshot";
import { AgentHostedExecution } from "./agent-hosted-execution";
import { AgentJobQueue } from "./agent-job-queue";
import { initializeAgentJobs } from "./agent-job-store";
import {
  connectAgentMailboxWebSocket,
  createAgentMailboxSocketTicket,
} from "./agent-mailbox";
import { parseStoredJson } from "./agent-object-values";
import { CloudflareAgentBrowser } from "./cloudflare-agent-browser";
import { CloudflareAgentComputer } from "./cloudflare-agent-computer";
import { CloudflareAgentInference } from "./cloudflare-agent-inference";
import { HttpError, json, parseJson, relayError } from "./http";
import { readTrustedContext } from "./internal-context";
import { initializeSocketTickets } from "./socket-ticket-store";

export class AgentObject extends DurableObject<Env> {
  private readonly workspace: Workspace;
  private readonly computer: CloudflareAgentComputer;
  private readonly queue: AgentJobQueue;
  private readonly hosted: AgentHostedExecution;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.workspace = createWorkspace(state);
    this.computer = new CloudflareAgentComputer(this.workspace);
    const broadcast = (event: JsonObject) => this.broadcast(event);
    this.queue = new AgentJobQueue(state.storage, env, broadcast);
    this.hosted = new AgentHostedExecution(
      state.storage,
      env,
      this.computer,
      new CloudflareAgentBrowser(env.BROWSER),
      new CloudflareAgentInference(env.AI, env.HOSTED_CELL_MODEL),
      this.queue,
      broadcast,
    );
    void state.blockConcurrencyWhile(async () => {
      initializeAgentJobs(state.storage);
      initializeSocketTickets(state.storage);
      if (env.HOSTED_CELL_ENABLED === "true") {
        await this.queue.scheduleNextAlarm();
      }
    });
  }

  executeComputer(command: string, cwd?: string) {
    return this.computer.execute(command, cwd);
  }

  runComputerGit(argv: string[], cwd?: string) {
    return this.computer.git(argv, cwd);
  }

  async fetch(request: Request) {
    try {
      if (request.headers.get("x-chief-internal-operation") === "delete-all") {
        readTrustedContext(request);
        await this.ctx.storage.deleteAll();
        return new Response(null, { status: 204 });
      }
      if (request.headers.get("upgrade") === "websocket") {
        return await connectAgentMailboxWebSocket(this.ctx, request);
      }
      return await this.route(request, readTrustedContext(request));
    } catch (error) {
      if (error instanceof HttpError) {
        return relayError(error.status, error.code, error.message);
      }
      return relayError(
        400,
        "invalid_request",
        "The agent request is invalid.",
      );
    }
  }

  async alarm() {
    await this.hosted.runDueJob();
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") socket.send("pong");
  }

  private async route(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path.endsWith("/enqueue")) {
      return this.queue.enqueue(request, context.workspaceId);
    }
    if (request.method === "POST" && path.endsWith("/ensure")) {
      return this.queue.enqueue(request, context.workspaceId, true);
    }
    if (request.method === "POST" && path.endsWith("/claim")) {
      return this.queue.claim(request, context);
    }
    if (request.method === "POST" && path.endsWith("/complete")) {
      return this.queue.complete(request, context);
    }
    if (request.method === "POST" && path.endsWith("/renew")) {
      return this.queue.renew(request, context);
    }
    if (request.method === "GET" && path.endsWith("/jobs")) {
      return this.queue.list(context);
    }
    if (request.method === "POST" && path.endsWith("/retry")) {
      return this.queue.retry(request, context);
    }
    if (request.method === "POST" && path.endsWith("/socket-tickets")) {
      return createAgentMailboxSocketTicket(this.ctx.storage, request, context);
    }
    if (
      (request.method === "GET" || request.method === "PUT") &&
      path.endsWith("/snapshot")
    ) {
      return this.cellSnapshot(request, context);
    }
    return relayError(404, "not_found", "Agent operation not found.");
  }

  private async cellSnapshot(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const agentId = agentIdSchema.parse(
      new URL(request.url).searchParams.get("agentId"),
    );
    const canTransfer =
      (context.principal.kind === "agent" &&
        context.principal.agentId === agentId) ||
      (context.principal.kind === "user" &&
        (context.principal.role === "owner" ||
          context.principal.role === "admin"));
    if (!canTransfer) {
      throw new HttpError(
        403,
        "cell_snapshot_denied",
        "Only this agent or a workspace owner can transfer its cell state.",
      );
    }
    const cellId = `${context.workspaceId}:${agentId}`;
    if (request.method === "GET") {
      const rows = this.ctx.storage.sql
        .exec<{ key: string; value_json: string }>(
          "SELECT key, value_json FROM cell_records ORDER BY key LIMIT 1000",
        )
        .toArray();
      return json(
        agentCellSnapshotSchema.parse({
          version: 2,
          cellId,
          workspaceId: context.workspaceId,
          agentId,
          exportedAt: new Date().toISOString(),
          records: rows.map((row) => ({
            key: String(row.key),
            value: parseStoredJson(row.value_json),
          })),
          files: await exportComputerFiles(this.computer),
        }),
      );
    }
    const snapshot = agentCellSnapshotSchema.parse(await parseJson(request));
    if (
      snapshot.cellId !== cellId ||
      snapshot.workspaceId !== context.workspaceId ||
      snapshot.agentId !== agentId
    ) {
      throw new HttpError(
        409,
        "cell_snapshot_scope_mismatch",
        "The cell snapshot belongs to another workspace or agent.",
      );
    }
    await importComputerFiles(this.computer, snapshot.files);
    const updatedAt = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM cell_records");
      for (const record of snapshot.records) {
        this.putCellRecord(record.key, record.value, updatedAt);
      }
    });
    return json({
      ok: true,
      importedRecords: snapshot.records.length,
      importedFiles: snapshot.files.length,
    });
  }

  private putCellRecord(key: string, value: JsonValue, updatedAt: string) {
    this.ctx.storage.sql.exec(
      `INSERT INTO cell_records (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      key,
      JSON.stringify(value),
      updatedAt,
    );
  }

  private broadcast(event: JsonObject) {
    const serialized = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(serialized);
      } catch {
        socket.close(1011, "Delivery failed");
      }
    }
  }
}

function createWorkspace(state: DurableObjectState) {
  return new Workspace({
    storage: state.storage,
    git: createGitClient(),
    defaultGitIdentity: {
      name: "Chief Agent",
      email: "agent@heychief.sh",
    },
  });
}
