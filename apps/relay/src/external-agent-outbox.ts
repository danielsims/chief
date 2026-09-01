import type { ExternalAgentDeliveryCommand } from "@chief/relay-contracts";
import {
  externalAgentDeliveryCommandSchema,
  externalAgentDeliveryResultSchema,
} from "@chief/relay-contracts";

import {
  fetchVerifiedEveEndpoint,
  randomToken,
  requireVerifiedEveEndpoint,
  sha256,
} from "./external-agent-channel-security";
import { HttpError } from "./http";
import { firstRow } from "./workspace-channel-store";
import { WorkspaceSecretStore } from "./workspace-secret-store";

interface RuntimeRow extends Record<string, SqlStorageValue> {
  agent_id: string;
  endpoint_url: string;
  token_secret_ref: string;
  connection_status: "pending_setup" | "connected" | "degraded";
}

interface OutboxRow extends Record<string, SqlStorageValue> {
  agent_id: string;
  delivery_id: string;
  payload_hash: string;
  payload_json: string;
  attempts: number;
  delivery_generation: number;
  status:
    | "queued"
    | "delivering"
    | "retry"
    | "accepted"
    | "reconciling"
    | "dead"
    | "dropped";
  delivering_since: string | null;
}

const MAX_DELIVERY_ATTEMPTS = 5;
const STALE_DELIVERY_MS = 60_000;

export class ExternalAgentOutbox {
  private readonly secrets: WorkspaceSecretStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
    private readonly inspectDelivery?: (
      workspaceId: string,
      row: OutboxRow,
    ) => Promise<
      { status: "accepted"; sessionId: string } | { status: "reconciling" }
    >,
  ) {
    this.secrets = new WorkspaceSecretStore(storage, env.RELAY_SECRET_KEY);
  }

  async enqueue(
    workspaceId: string,
    agentId: string,
    command: ExternalAgentDeliveryCommand,
    conversationId: string,
    threadRootId?: string,
  ) {
    if (this.runtime(agentId)?.connection_status !== "connected") return false;
    const semanticHash = await sha256(
      JSON.stringify({
        message: command.payload.message,
        conversationId,
        threadRootId: threadRootId ?? null,
      }),
    );
    const capability = randomToken();
    const sessionAddress = `chief_${await sha256(
      JSON.stringify({
        workspaceId,
        agentId,
        conversationId,
        threadRootId: threadRootId ?? null,
      }),
    )}`;
    const payload = externalAgentDeliveryCommandSchema.parse({
      ...command,
      payload: {
        ...command.payload,
        deliveryGeneration: 1,
        sessionAddress,
        continuation: { capability },
      },
    });
    const now = new Date().toISOString();
    const capabilityHash = await sha256(capability);
    const existing = this.storage.transactionSync(() => {
      const claimed = firstRow<OutboxRow>(
        this.storage.sql.exec(
          "SELECT * FROM external_agent_outbox WHERE agent_id = ? AND delivery_id = ?",
          agentId,
          command.payload.deliveryId,
        ),
      );
      if (claimed) return claimed;
      this.storage.sql.exec(
        `INSERT INTO external_agent_outbox (agent_id, delivery_id, payload_hash, payload_json, capability_hash, conversation_id, thread_root_id, session_address, delivery_generation, status, attempts, next_attempt_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'queued', 0, ?, ?, ?)`,
        agentId,
        payload.payload.deliveryId,
        semanticHash,
        JSON.stringify(payload),
        capabilityHash,
        conversationId,
        threadRootId ?? null,
        sessionAddress,
        now,
        now,
        now,
      );
      return undefined;
    });
    if (
      existing?.payload_hash !== undefined &&
      existing.payload_hash !== semanticHash
    )
      throw new HttpError(
        409,
        "external_delivery_conflict",
        "This delivery id was already used with different content.",
      );
    await this.storage.setAlarm(Date.now());
    return true;
  }

  async drain(workspaceId: string) {
    const now = Date.now();
    this.storage.sql.exec(
      `UPDATE external_agent_outbox SET status = 'retry', next_attempt_at = ?, delivering_since = NULL WHERE status = 'delivering' AND delivering_since < ?`,
      new Date(now).toISOString(),
      new Date(now - STALE_DELIVERY_MS).toISOString(),
    );
    const row = firstRow<OutboxRow>(
      this.storage.sql.exec(
        `SELECT * FROM external_agent_outbox WHERE status IN ('queued', 'retry') AND next_attempt_at <= ? ORDER BY next_attempt_at, created_at LIMIT 1`,
        new Date(now).toISOString(),
      ),
    );
    if (!row) return this.scheduleNext();
    const claimed = this.storage.transactionSync(() => {
      const current = firstRow<OutboxRow>(
        this.storage.sql.exec(
          "SELECT * FROM external_agent_outbox WHERE agent_id = ? AND delivery_id = ?",
          row.agent_id,
          row.delivery_id,
        ),
      );
      if (!current || !["queued", "retry"].includes(current.status))
        return false;
      this.storage.sql.exec(
        `UPDATE external_agent_outbox SET status = 'delivering', attempts = attempts + 1, delivering_since = ?, updated_at = ? WHERE agent_id = ? AND delivery_id = ?`,
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        row.agent_id,
        row.delivery_id,
      );
      return true;
    });
    if (!claimed) return this.scheduleNext();
    // A fresh alarm is the crash-recovery lease for this claimed delivery. If
    // the isolate dies during fetch, the row becomes retryable after the lease.
    await this.storage.setAlarm(now + STALE_DELIVERY_MS);
    try {
      await this.deliver(workspaceId, row);
    } catch (error) {
      const attempts = row.attempts + 1;
      const dead = attempts >= MAX_DELIVERY_ATTEMPTS;
      const delay = Math.min(300_000, 5_000 * 4 ** Math.max(0, attempts - 1));
      this.storage.sql.exec(
        `UPDATE external_agent_outbox SET status = ?, next_attempt_at = ?, delivering_since = NULL, last_error = ?, updated_at = ? WHERE agent_id = ? AND delivery_id = ?`,
        dead ? "dead" : "retry",
        new Date(Date.now() + delay).toISOString(),
        error instanceof Error ? error.message : String(error),
        new Date().toISOString(),
        row.agent_id,
        row.delivery_id,
      );
    }
    await this.scheduleNext();
  }

  async requeue(agentId: string, deliveryId: string) {
    const row = firstRow<OutboxRow>(
      this.storage.sql.exec(
        "SELECT * FROM external_agent_outbox WHERE agent_id = ? AND delivery_id = ?",
        agentId,
        deliveryId,
      ),
    );
    if (!row)
      throw new HttpError(
        404,
        "external_delivery_not_found",
        "The external delivery does not exist.",
      );
    if (row.status !== "dead")
      throw new HttpError(
        409,
        "external_delivery_not_dead",
        "Only dead-letter deliveries can be requeued.",
      );
    const now = new Date().toISOString();
    this.storage.sql.exec(
      `UPDATE external_agent_outbox SET status = 'queued', attempts = 0, next_attempt_at = ?, delivering_since = NULL, last_error = NULL, updated_at = ? WHERE agent_id = ? AND delivery_id = ?`,
      now,
      now,
      agentId,
      deliveryId,
    );
    await this.storage.setAlarm(Date.now());
  }

  async recover(
    workspaceId: string,
    agentId: string,
    deliveryId: string,
    decision: "inspect" | "resend" | "drop",
  ) {
    const row = this.requireReconciling(agentId, deliveryId);
    const witnessed = await (this.inspectDelivery ?? this.inspect.bind(this))(
      workspaceId,
      row,
    );
    if (witnessed.status === "accepted") {
      this.accept(agentId, deliveryId, witnessed.sessionId);
      return witnessed;
    }
    if (decision === "inspect") return witnessed;
    if (decision === "drop") {
      this.storage.sql.exec(
        `UPDATE external_agent_outbox SET status = 'dropped', delivering_since = NULL, last_error = NULL, updated_at = ? WHERE agent_id = ? AND delivery_id = ? AND status = 'reconciling'`,
        new Date().toISOString(),
        agentId,
        deliveryId,
      );
      return { status: "dropped" as const };
    }
    const parsed = externalAgentDeliveryCommandSchema.parse(
      JSON.parse(row.payload_json),
    );
    const generation = row.delivery_generation + 1;
    const payload = {
      ...parsed,
      payload: { ...parsed.payload, deliveryGeneration: generation },
    };
    const now = new Date().toISOString();
    this.storage.sql.exec(
      `UPDATE external_agent_outbox SET status = 'queued', payload_json = ?, delivery_generation = ?, attempts = 0, next_attempt_at = ?, delivering_since = NULL, session_id = NULL, last_error = NULL, updated_at = ? WHERE agent_id = ? AND delivery_id = ? AND status = 'reconciling'`,
      JSON.stringify(payload),
      generation,
      now,
      now,
      agentId,
      deliveryId,
    );
    await this.storage.setAlarm(Date.now());
    return { status: "resend_queued" as const, deliveryGeneration: generation };
  }

  reconciliations(agentId: string) {
    return this.storage.sql
      .exec<
        {
          delivery_id: string;
          delivery_generation: number;
          last_error: string | null;
          created_at: string;
        } & Record<string, SqlStorageValue>
      >(
        `SELECT delivery_id, delivery_generation, last_error, created_at FROM external_agent_outbox WHERE agent_id = ? AND status = 'reconciling' ORDER BY created_at`,
        agentId,
      )
      .toArray()
      .map((row) => ({
        deliveryId: row.delivery_id,
        deliveryGeneration: row.delivery_generation,
        lastError: row.last_error,
        createdAt: row.created_at,
      }));
  }

  private runtime(agentId: string) {
    return firstRow<RuntimeRow>(
      this.storage.sql.exec(
        "SELECT agent_id, endpoint_url, token_secret_ref, connection_status FROM external_agent_runtimes WHERE agent_id = ?",
        agentId,
      ),
    );
  }

  private async deliver(workspaceId: string, row: OutboxRow) {
    const runtime = this.runtime(row.agent_id);
    if (!runtime) throw new Error("External agent runtime is unavailable.");
    requireVerifiedEveEndpoint(runtime.endpoint_url);
    const token = await this.secrets.get(workspaceId, runtime.token_secret_ref);
    if (!token)
      throw new Error("External agent channel credential is unavailable.");
    const response = await fetchVerifiedEveEndpoint(runtime.endpoint_url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: row.payload_json,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`External channel returned HTTP ${response.status}.`);
    }
    const result = externalAgentDeliveryResultSchema.parse(
      await response.json(),
    );
    if (result.status === "reconciling") {
      this.storage.sql.exec(
        `UPDATE external_agent_outbox SET status = 'reconciling', delivering_since = NULL, last_error = ?, updated_at = ? WHERE agent_id = ? AND delivery_id = ?`,
        "Eve accepted the reconciliation handoff without a durable witness.",
        new Date().toISOString(),
        row.agent_id,
        row.delivery_id,
      );
      return;
    }
    this.accept(row.agent_id, row.delivery_id, result.sessionId);
  }

  private requireReconciling(agentId: string, deliveryId: string) {
    const row = firstRow<OutboxRow>(
      this.storage.sql.exec(
        "SELECT * FROM external_agent_outbox WHERE agent_id = ? AND delivery_id = ?",
        agentId,
        deliveryId,
      ),
    );
    if (!row)
      throw new HttpError(
        404,
        "external_delivery_not_found",
        "The external delivery does not exist.",
      );
    if (row.status !== "reconciling")
      throw new HttpError(
        409,
        "external_delivery_not_reconciling",
        "Only a delivery awaiting reconciliation can be recovered.",
      );
    return row;
  }

  private accept(agentId: string, deliveryId: string, sessionId: string) {
    this.storage.sql.exec(
      `UPDATE external_agent_outbox SET status = 'accepted', session_id = ?, delivering_since = NULL, last_error = NULL, updated_at = ? WHERE agent_id = ? AND delivery_id = ?`,
      sessionId,
      new Date().toISOString(),
      agentId,
      deliveryId,
    );
  }

  private async inspect(workspaceId: string, row: OutboxRow) {
    const runtime = this.runtime(row.agent_id);
    if (!runtime) throw new Error("External agent runtime is unavailable.");
    const token = await this.secrets.get(workspaceId, runtime.token_secret_ref);
    if (!token)
      throw new Error("External agent channel credential is unavailable.");
    const endpoint = new URL(runtime.endpoint_url);
    endpoint.pathname = endpoint.pathname.replace(
      /\/messages$/u,
      "/deliveries/inspect",
    );
    const response = await fetchVerifiedEveEndpoint(endpoint.toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: row.payload_json,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `External channel inspection returned HTTP ${response.status}.`,
      );
    }
    return externalAgentDeliveryResultSchema.parse(await response.json());
  }

  private async scheduleNext() {
    const pending = firstRow<
      { next_attempt_at: string } & Record<string, SqlStorageValue>
    >(
      this.storage.sql.exec(
        `SELECT next_attempt_at FROM external_agent_outbox WHERE status IN ('queued', 'retry') ORDER BY next_attempt_at LIMIT 1`,
      ),
    );
    const delivering = firstRow<
      { delivering_since: string } & Record<string, SqlStorageValue>
    >(
      this.storage.sql.exec(
        `SELECT delivering_since FROM external_agent_outbox WHERE status = 'delivering' AND delivering_since IS NOT NULL ORDER BY delivering_since LIMIT 1`,
      ),
    );
    const deadlines = [
      pending ? new Date(pending.next_attempt_at).getTime() : undefined,
      delivering
        ? new Date(delivering.delivering_since).getTime() + STALE_DELIVERY_MS
        : undefined,
    ].filter((value): value is number => value !== undefined);
    if (deadlines.length > 0)
      await this.storage.setAlarm(Math.min(...deadlines));
    else await this.storage.deleteAlarm();
  }
}
