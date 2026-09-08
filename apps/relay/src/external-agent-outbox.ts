import type { ExternalAgentDeliveryCommand } from "@chief/relay-contracts";
import {
  externalAgentDeliveryCommandSchema,
  externalAgentDeliveryResultSchema,
  parseJsonObject,
} from "@chief/relay-contracts";

import {
  fetchVerifiedEveEndpoint,
  randomToken,
  requireVerifiedEveEndpoint,
  sha256,
} from "./external-agent-channel-security";
import { EXTERNAL_DELIVERY_LEASE_MS } from "./external-agent-outbox-deadline";
import { HttpError } from "./http";
import { acceptDeliveryExternalAgentOutbox } from "./queries/external-agent-outbox/accept-delivery";
import { claimDeliveryExternalAgentOutbox } from "./queries/external-agent-outbox/claim-delivery";
import { dropReconcilingDeliveryExternalAgentOutbox } from "./queries/external-agent-outbox/drop-reconciling-delivery";
import { getDeliveryExternalAgentOutbox } from "./queries/external-agent-outbox/get-delivery";
import { getNextDueDeliveryExternalAgentOutbox } from "./queries/external-agent-outbox/get-next-due-delivery";
import { insertDeliveryExternalAgentOutbox } from "./queries/external-agent-outbox/insert-delivery";
import { listReconcilingDeliveriesExternalAgentOutbox } from "./queries/external-agent-outbox/list-reconciling-deliveries";
import { markDeliveryReconcilingExternalAgentOutbox } from "./queries/external-agent-outbox/mark-delivery-reconciling";
import { recordDeliveryFailureExternalAgentOutbox } from "./queries/external-agent-outbox/record-delivery-failure";
import { requeueDeliveryExternalAgentOutbox } from "./queries/external-agent-outbox/requeue-delivery";
import { resendReconcilingDeliveryExternalAgentOutbox } from "./queries/external-agent-outbox/resend-reconciling-delivery";
import { retryStaleDeliveriesExternalAgentOutbox } from "./queries/external-agent-outbox/retry-stale-deliveries";
import { externalAgentRuntimesFindRuntimeAgentIdEndpointUrlTokenSecretRefConnectionStatus } from "./queries/external-agent-runtimes/find-runtime-agent-id-endpoint-url-token-secret-ref-connection-status";
import { externalRuntimeOwner } from "./workspace-agent-runtime";
import { firstRow } from "./workspace-channel-store";
import { workspacePeople } from "./workspace-member-names";
import { setWorkspaceAlarm } from "./workspace-schedule-store";
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
    const runtime = this.runtime(agentId);
    if (!runtime) return false;
    if (runtime.connection_status !== "connected") {
      throw new HttpError(
        409,
        "external_agent_unavailable",
        "This agent deployment is not connected.",
      );
    }
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
        agentId,
        conversationId,
        threadRootId: threadRootId ?? undefined,
        continuation: { capability },
      },
    });
    const now = new Date().toISOString();
    const capabilityHash = await sha256(capability);
    const existing = this.storage.transactionSync(() => {
      const claimed = firstRow<OutboxRow>(
        getDeliveryExternalAgentOutbox(
          this.storage,
          agentId,
          command.payload.deliveryId,
        ),
      );
      if (claimed) return claimed;
      insertDeliveryExternalAgentOutbox(this.storage, {
        agentId: agentId,
        deliveryId: payload.payload.deliveryId,
        payloadHash: semanticHash,
        payloadJson: JSON.stringify(payload),
        capabilityHash: capabilityHash,
        conversationId: conversationId,
        threadRootId: threadRootId ?? null,
        sessionAddress: sessionAddress,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
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
    retryStaleDeliveriesExternalAgentOutbox(
      this.storage,
      new Date(now).toISOString(),
      new Date(now - EXTERNAL_DELIVERY_LEASE_MS).toISOString(),
    );
    const row = firstRow<OutboxRow>(
      getNextDueDeliveryExternalAgentOutbox(
        this.storage,
        new Date(now).toISOString(),
      ),
    );
    if (!row) return this.scheduleNext();
    const claimed = this.storage.transactionSync(() => {
      const current = firstRow<OutboxRow>(
        getDeliveryExternalAgentOutbox(
          this.storage,
          row.agent_id,
          row.delivery_id,
        ),
      );
      if (!current || !["queued", "retry"].includes(current.status))
        return false;
      claimDeliveryExternalAgentOutbox(this.storage, {
        deliveringSince: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        agentId: row.agent_id,
        deliveryId: row.delivery_id,
      });
      return true;
    });
    if (!claimed) return this.scheduleNext();
    // A fresh alarm is the crash-recovery lease for this claimed delivery. If
    // the isolate dies during fetch, the row becomes retryable after the lease.
    await setWorkspaceAlarm(this.storage, now + EXTERNAL_DELIVERY_LEASE_MS);
    try {
      await this.deliver(workspaceId, row);
    } catch (error) {
      const attempts = row.attempts + 1;
      const dead = attempts >= MAX_DELIVERY_ATTEMPTS;
      const delay = Math.min(300_000, 5_000 * 4 ** Math.max(0, attempts - 1));
      recordDeliveryFailureExternalAgentOutbox(this.storage, {
        status: dead ? "dead" : "retry",
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
        agentId: row.agent_id,
        deliveryId: row.delivery_id,
      });
    }
    await this.scheduleNext();
  }

  async requeue(agentId: string, deliveryId: string) {
    const row = firstRow<OutboxRow>(
      getDeliveryExternalAgentOutbox(this.storage, agentId, deliveryId),
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
    requeueDeliveryExternalAgentOutbox(this.storage, {
      nextAttemptAt: now,
      updatedAt: now,
      agentId: agentId,
      deliveryId: deliveryId,
    });
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
      dropReconcilingDeliveryExternalAgentOutbox(this.storage, {
        updatedAt: new Date().toISOString(),
        agentId: agentId,
        deliveryId: deliveryId,
      });
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
    resendReconcilingDeliveryExternalAgentOutbox(this.storage, {
      payloadJson: JSON.stringify(payload),
      deliveryGeneration: generation,
      nextAttemptAt: now,
      updatedAt: now,
      agentId: agentId,
      deliveryId: deliveryId,
    });
    await this.storage.setAlarm(Date.now());
    return { status: "resend_queued" as const, deliveryGeneration: generation };
  }

  reconciliations(agentId: string) {
    return listReconcilingDeliveriesExternalAgentOutbox<
      {
        delivery_id: string;
        delivery_generation: number;
        last_error: string | null;
        created_at: string;
      } & Record<string, SqlStorageValue>
    >(this.storage, agentId).map((row) => ({
      deliveryId: row.delivery_id,
      deliveryGeneration: row.delivery_generation,
      lastError: row.last_error,
      createdAt: row.created_at,
    }));
  }

  private runtime(agentId: string) {
    return firstRow<RuntimeRow>(
      externalAgentRuntimesFindRuntimeAgentIdEndpointUrlTokenSecretRefConnectionStatus(
        this.storage,
        externalRuntimeOwner(this.storage, agentId),
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
      body: this.deliveryBody(row),
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
      markDeliveryReconcilingExternalAgentOutbox(this.storage, {
        lastError:
          "Eve accepted the reconciliation handoff without a durable witness.",
        updatedAt: new Date().toISOString(),
        agentId: row.agent_id,
        deliveryId: row.delivery_id,
      });
      return;
    }
    this.accept(row.agent_id, row.delivery_id, result.sessionId);
  }

  private requireReconciling(agentId: string, deliveryId: string) {
    const row = firstRow<OutboxRow>(
      getDeliveryExternalAgentOutbox(this.storage, agentId, deliveryId),
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

  private deliveryBody(row: OutboxRow) {
    const envelope = parseJsonObject(JSON.parse(row.payload_json));
    if (!envelope) {
      return row.payload_json;
    }
    const payload = parseJsonObject(envelope.payload);
    if (!payload) return row.payload_json;
    return JSON.stringify({
      ...envelope,
      payload: { ...payload, people: workspacePeople(this.storage) },
    });
  }

  private accept(agentId: string, deliveryId: string, sessionId: string) {
    acceptDeliveryExternalAgentOutbox(this.storage, {
      sessionId: sessionId,
      updatedAt: new Date().toISOString(),
      agentId: agentId,
      deliveryId: deliveryId,
    });
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
      body: this.deliveryBody(row),
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
    await setWorkspaceAlarm(this.storage);
  }
}
