import { Workspace } from "@cloudflare/computer";
import { createGitClient } from "@cloudflare/computer/git";
import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import { z } from "zod";

import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import {
  agentCellSnapshotSchema,
  agentIdSchema,
  agentJobSchema,
  enqueueAgentJobCommandSchema,
} from "@chief/relay-contracts";

import {
  exportComputerFiles,
  importComputerFiles,
} from "./agent-computer-snapshot";
import { createAgentExecutionEnvironmentFactory } from "./agent-execution-environment";
import { AgentJobQueue } from "./agent-job-queue";
import { initializeAgentJobs } from "./agent-job-store";
import {
  connectAgentMailboxWebSocket,
  createAgentMailboxSocketTicket,
} from "./agent-mailbox";
import { parseStoredJson } from "./agent-object-values";
import { AgentRuntime } from "./agent-runtime";
import { agentTelemetryAttributes } from "./agent-tracing";
import { CloudflareAgentComputer } from "./cloudflare-agent-computer";
import { attempt, runEffect, runResponse, sync } from "./effect";
import { HttpError, json, parseJson, relayError } from "./http";
import {
  readTrustedContext,
  trustedTelemetryAttributes,
} from "./internal-context";
import { initializeSocketTickets } from "./socket-ticket-store";

const enqueuedAgentJobSchema = z.object({ job: agentJobSchema });

export class AgentObject extends DurableObject<Env> {
  private readonly workspace: Workspace;
  private readonly computer: CloudflareAgentComputer;
  private readonly queue: AgentJobQueue;
  private readonly runtime: AgentRuntime;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.workspace = createWorkspace(state);
    this.computer = new CloudflareAgentComputer(this.workspace);
    const broadcast = (event: JsonObject) => this.broadcast(event);
    this.queue = new AgentJobQueue(state.storage, env, broadcast);
    this.runtime = new AgentRuntime(
      state.storage,
      env,
      createAgentExecutionEnvironmentFactory(env, this.workspace),
      this.queue,
      broadcast,
    );
    void state.blockConcurrencyWhile(async () => {
      initializeAgentJobs(state.storage);
      initializeSocketTickets(state.storage);
      if (env.HOSTED_CELL_ENABLED === "true") {
        await runEffect(this.runtime.scheduleNextAlarm(), env);
      }
    });
  }

  executeComputer(command: string, cwd?: string) {
    return this.computer.execute(command, cwd);
  }

  runComputerGit(argv: string[], cwd?: string) {
    return this.computer.git(argv, cwd);
  }

  fetch(request: Request) {
    const ctx = this.ctx;
    const route = this.route.bind(this);
    const program = Effect.gen(function* () {
      if (request.headers.get("x-chief-internal-operation") === "delete-all") {
        yield* sync("agent.identity", () => readTrustedContext(request));
        yield* attempt("agent.delete_all", () => ctx.storage.deleteAll());
        return new Response(null, { status: 204 });
      }
      if (request.headers.get("upgrade") === "websocket") {
        return yield* attempt("agent.websocket.connect", () =>
          connectAgentMailboxWebSocket(ctx, request),
        );
      }
      const context = yield* sync("agent.context", () =>
        readTrustedContext(request),
      );
      return yield* route(request, context);
    });
    return runResponse(program, this.env, {
      operation: "agent.fetch",
      attributes: trustedTelemetryAttributes(request),
      workflowId: request.headers.get("x-chief-workflow-id") ?? undefined,
    });
  }

  async alarm() {
    const workflowId = await this.runtime
      .currentWorkflowId()
      .catch(() => undefined);
    return runEffect(this.runtime.runDueJob(), this.env, workflowId);
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") socket.send("pong");
  }

  private route(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const ctx = this.ctx;
    const queue = this.queue;
    const runtime = this.runtime;
    const cellSnapshot = this.cellSnapshot.bind(this);
    return Effect.gen(function* () {
      const path = new URL(request.url).pathname;
      if (
        request.method === "POST" &&
        (path.endsWith("/enqueue") || path.endsWith("/ensure"))
      ) {
        const repairTerminal = path.endsWith("/ensure");
        if (!repairTerminal && context.principal.kind === "user") {
          const body = yield* attempt("agent.job.enqueue.read", () =>
            request.clone().json(),
          );
          const command = yield* sync("agent.job.enqueue.parse", () =>
            enqueueAgentJobCommandSchema.parse(body),
          );
          if (command.payload.kind === "conversation.message") {
            const conversationId = command.payload.payload.conversationId;
            if (typeof conversationId === "string") {
              yield* attempt("agent.turn.supersede", () =>
                runtime.supersedeConversation(
                  conversationId,
                  command.payload.id,
                ),
              );
            }
          }
        }
        const response = yield* attempt(
          repairTerminal ? "agent.job.ensure" : "agent.job.enqueue",
          () => queue.enqueue(request, context.workspaceId, repairTerminal),
        );
        const result = yield* attempt("agent.job.enqueue.decode", () =>
          response.clone().json(),
        );
        const job = yield* sync(
          "agent.job.enqueue.validate",
          () => enqueuedAgentJobSchema.parse(result).job,
        );
        yield* Effect.annotateCurrentSpan(agentTelemetryAttributes(job));
        yield* Effect.logInfo({
          event: "agent.job.enqueued",
          ...agentTelemetryAttributes(job),
        });
        return response;
      }
      if (request.method === "POST" && path.endsWith("/claim")) {
        return yield* attempt("agent.job.claim", () =>
          queue.claim(request, context),
        );
      }
      if (request.method === "POST" && path.endsWith("/complete")) {
        return yield* attempt("agent.job.complete", () =>
          queue.complete(request, context),
        );
      }
      if (request.method === "POST" && path.endsWith("/renew")) {
        return yield* attempt("agent.job.renew", () =>
          queue.renew(request, context),
        );
      }
      if (request.method === "GET" && path.endsWith("/jobs")) {
        return yield* attempt("agent.job.list", () => queue.list(context));
      }
      if (request.method === "POST" && path.endsWith("/retry")) {
        return yield* attempt("agent.job.retry", () =>
          queue.retry(request, context),
        );
      }
      if (request.method === "POST" && path.endsWith("/socket-tickets")) {
        return yield* attempt("agent.socket_ticket.create", () =>
          createAgentMailboxSocketTicket(ctx.storage, request, context),
        );
      }
      if (
        (request.method === "GET" || request.method === "PUT") &&
        path.endsWith("/snapshot")
      ) {
        return yield* attempt("agent.snapshot", () =>
          cellSnapshot(request, context),
        );
      }
      return relayError(404, "not_found", "Agent operation not found.");
    }).pipe(
      Effect.withSpan("agent.operation", {
        attributes: { "url.path": new URL(request.url).pathname },
      }),
    );
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
