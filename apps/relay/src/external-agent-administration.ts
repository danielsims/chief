import { z } from "zod";

import {
  agentIdSchema,
  agentSummarySchema,
  externalAgentConnectionVerificationInputSchema,
  externalAgentConnectionVerificationResultSchema,
  externalAgentCredentialRotationResultSchema,
  externalAgentDeliveryRecoverySchema,
  externalAgentEndpointUpdateResultSchema,
  externalAgentEndpointUpdateSchema,
} from "@chief/relay-contracts";

import {
  randomToken,
  requireVerifiedEveEndpoint,
  sha256,
} from "./external-agent-channel-security";
import { ExternalAgentOutbox } from "./external-agent-outbox";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import { firstRow, WorkspaceChannelStore } from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";
import { completeEveWorkspaceOnboarding } from "./workspace-eve-onboarding";
import { WorkspaceSecretStore } from "./workspace-secret-store";

interface RuntimeRow extends Record<string, SqlStorageValue> {
  endpoint_url: string;
  token_secret_ref: string;
  delivery_signing_key_id: string;
  delivery_signing_secret_ref: string;
  registration_result_json: string;
  replaces_native: number;
}

export class ExternalAgentAdministration {
  private readonly channels: WorkspaceChannelStore;
  private readonly outbox: ExternalAgentOutbox;
  private readonly secrets: WorkspaceSecretStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
    this.outbox = new ExternalAgentOutbox(storage, env);
    this.secrets = new WorkspaceSecretStore(storage, env.RELAY_SECRET_KEY);
  }

  async requeue(request: Request, rawAgentId: string, deliveryId: string) {
    const context = readTrustedContext(request);
    requireWorkspaceAdministrator(this.channels, context.principal);
    await this.outbox.requeue(agentIdSchema.parse(rawAgentId), deliveryId);
    return json({ requeued: true });
  }

  async verifyConnection(request: Request, rawAgentId: string) {
    const context = readTrustedContext(request);
    requireWorkspaceAdministrator(this.channels, context.principal);
    const agentId = agentIdSchema.parse(rawAgentId);
    let verificationInput: unknown = {};
    const verificationBody = (await request.text()).trim();
    if (verificationBody) {
      try {
        verificationInput = JSON.parse(verificationBody);
      } catch {
        throw new HttpError(
          400,
          "invalid_json",
          "The Eve connection verification request is not valid JSON.",
        );
      }
    }
    const verification =
      externalAgentConnectionVerificationInputSchema.safeParse(
        verificationInput,
      );
    if (!verification.success) {
      throw new HttpError(
        400,
        "external_agent_verification_invalid",
        verification.error.issues[0]?.message ??
          "The Eve connection verification request is invalid.",
      );
    }
    const { selectedApps } = verification.data;
    const runtime = firstRow<RuntimeRow>(
      this.storage.sql.exec(
        "SELECT endpoint_url, token_secret_ref, delivery_signing_secret_ref, registration_result_json FROM external_agent_runtimes WHERE agent_id = ?",
        agentId,
      ),
    );
    if (!runtime)
      throw new HttpError(
        404,
        "external_agent_not_found",
        "This external agent is not registered.",
      );
    const token = await this.secrets.get(
      context.workspaceId,
      runtime.token_secret_ref,
    );
    if (!token)
      throw new HttpError(
        409,
        "external_agent_secret_missing",
        "Rotate the connection credential before verifying this agent.",
      );
    requireVerifiedEveEndpoint(runtime.endpoint_url);
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (!workspace.snapshot_json)
      throw new HttpError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace cannot update agents.",
      );
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    let registrationPayload: unknown;
    try {
      registrationPayload = JSON.parse(runtime.registration_result_json);
    } catch {
      throw new HttpError(
        409,
        "external_agent_registration_invalid",
        "This external agent registration is invalid.",
      );
    }
    const storedAgentResult = z
      .object({ agent: agentSummarySchema })
      .safeParse(registrationPayload);
    if (!storedAgentResult.success)
      throw new HttpError(
        409,
        "external_agent_registration_invalid",
        "This external agent registration is invalid.",
      );
    const storedAgent = storedAgentResult.data.agent;
    if (storedAgent.runtime.kind !== "external-channel") {
      throw new HttpError(
        409,
        "external_agent_registration_invalid",
        "This external agent registration is invalid.",
      );
    }
    const connectedAgent = {
      ...storedAgent,
      runtime: {
        ...storedAgent.runtime,
        endpoint: runtime.endpoint_url,
        connectionStatus: "connected" as const,
      },
    };
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        "UPDATE external_agent_runtimes SET connection_status = 'connected', updated_at = ? WHERE agent_id = ?",
        new Date().toISOString(),
        agentId,
      );
      this.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify({
          ...snapshot,
          selectedApps: selectedApps ?? snapshot.selectedApps,
          agents: snapshot.agents.map((agent) =>
            agent.id === agentId
              ? {
                  ...connectedAgent,
                  subagents:
                    connectedAgent.subagents.length > 0
                      ? connectedAgent.subagents
                      : agent.subagents,
                }
              : agent,
          ),
        }),
      );
    });
    if (agentId === "chief") {
      await completeEveWorkspaceOnboarding({
        env: this.env,
        storage: this.storage,
        channels: this.channels,
        workspaceId: context.workspaceId,
        createdAt: workspace.created_at,
        createdByUserId: workspace.created_by_user_id,
        snapshot,
        selectedApps,
      });
    }
    return json(
      externalAgentConnectionVerificationResultSchema.parse({
        status: "connected",
      }),
    );
  }

  async updateEndpoint(request: Request, rawAgentId: string) {
    const context = readTrustedContext(request);
    requireWorkspaceAdministrator(this.channels, context.principal);
    const agentId = agentIdSchema.parse(rawAgentId);
    const { endpoint } = externalAgentEndpointUpdateSchema.parse(
      await parseJson(request),
    );
    requireVerifiedEveEndpoint(endpoint);
    const runtime = firstRow<RuntimeRow>(
      this.storage.sql.exec(
        "SELECT endpoint_url, token_secret_ref, delivery_signing_key_id, delivery_signing_secret_ref, registration_result_json, replaces_native FROM external_agent_runtimes WHERE agent_id = ?",
        agentId,
      ),
    );
    if (!runtime)
      throw new HttpError(
        404,
        "external_agent_not_found",
        "This external agent is not registered.",
      );
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (!workspace.snapshot_json)
      throw new HttpError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace cannot update agents.",
      );
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        "UPDATE external_agent_runtimes SET endpoint_url = ?, updated_at = ? WHERE agent_id = ?",
        endpoint,
        new Date().toISOString(),
        agentId,
      );
      this.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify({
          ...snapshot,
          agents: snapshot.agents.map((agent) =>
            agent.id === agentId && agent.runtime.kind === "external-channel"
              ? {
                  ...agent,
                  runtime: { ...agent.runtime, endpoint },
                }
              : agent,
          ),
        }),
      );
    });
    return json(
      externalAgentEndpointUpdateResultSchema.parse({ updated: true, agentId }),
    );
  }

  async recover(request: Request, rawAgentId: string, deliveryId: string) {
    const context = readTrustedContext(request);
    requireWorkspaceAdministrator(this.channels, context.principal);
    const { decision } = externalAgentDeliveryRecoverySchema.parse(
      await parseJson(request),
    );
    return json(
      await this.outbox.recover(
        context.workspaceId,
        agentIdSchema.parse(rawAgentId),
        deliveryId,
        decision,
      ),
    );
  }

  reconciliations(request: Request, rawAgentId: string) {
    const context = readTrustedContext(request);
    requireWorkspaceAdministrator(this.channels, context.principal);
    return json({
      deliveries: this.outbox.reconciliations(agentIdSchema.parse(rawAgentId)),
    });
  }

  disconnect(request: Request, rawAgentId: string) {
    const context = readTrustedContext(request);
    requireWorkspaceAdministrator(this.channels, context.principal);
    const agentId = agentIdSchema.parse(rawAgentId);
    const runtime = firstRow<RuntimeRow>(
      this.storage.sql.exec(
        "SELECT token_secret_ref, delivery_signing_secret_ref, replaces_native FROM external_agent_runtimes WHERE agent_id = ?",
        agentId,
      ),
    );
    if (!runtime)
      throw new HttpError(
        404,
        "external_agent_not_found",
        "This external agent is not registered.",
      );
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (!workspace.snapshot_json)
      throw new HttpError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace cannot update agents.",
      );
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    const externalAgent = snapshot.agents.find(
      (agent) =>
        agent.id === agentId && agent.runtime.kind === "external-channel",
    );
    const replacesNative = runtime.replaces_native === 1;
    const restoreNative = replacesNative && externalAgent;
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        "DELETE FROM external_agent_inbound_receipts WHERE agent_id = ?",
        agentId,
      );
      this.storage.sql.exec(
        "DELETE FROM external_agent_outbox WHERE agent_id = ?",
        agentId,
      );
      this.storage.sql.exec(
        "DELETE FROM external_agent_runtimes WHERE agent_id = ?",
        agentId,
      );
      if (!replacesNative) {
        this.storage.sql.exec(
          "DELETE FROM members WHERE principal_kind = 'agent' AND principal_id = ?",
          agentId,
        );
      }
      this.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify({
          ...snapshot,
          agents: restoreNative
            ? snapshot.agents.map((agent) =>
                agent.id === agentId
                  ? { ...externalAgent, runtime: { kind: "native-cell" } }
                  : agent,
              )
            : replacesNative
              ? snapshot.agents
              : snapshot.agents.filter((agent) => agent.id !== agentId),
        }),
      );
      this.secrets.delete(context.workspaceId, runtime.token_secret_ref);
      this.secrets.delete(
        context.workspaceId,
        runtime.delivery_signing_secret_ref,
      );
    });
    return json({ disconnected: true, agentId });
  }

  async rotateCredentials(request: Request, rawAgentId: string) {
    const context = readTrustedContext(request);
    requireWorkspaceAdministrator(this.channels, context.principal);
    const agentId = agentIdSchema.parse(rawAgentId);
    const runtime = firstRow<RuntimeRow>(
      this.storage.sql.exec(
        "SELECT token_secret_ref, delivery_signing_key_id, delivery_signing_secret_ref, registration_result_json FROM external_agent_runtimes WHERE agent_id = ?",
        agentId,
      ),
    );
    if (!runtime)
      throw new HttpError(
        404,
        "external_agent_not_found",
        "This external agent is not registered.",
      );
    const token = randomToken();
    const deliverySigningKeyId = `dsk_${crypto.randomUUID()}`;
    const deliverySigningSecret = randomToken();
    const deliverySigningSecretRef = `external-agent.${agentId}.delivery-signing.${deliverySigningKeyId}`;
    const preparedDeliverySigningSecret = await this.secrets.prepare(
      context.workspaceId,
      deliverySigningSecretRef,
      deliverySigningSecret,
    );
    const prepared = await this.secrets.prepare(
      context.workspaceId,
      runtime.token_secret_ref,
      token,
    );
    const tokenHash = await sha256(token);
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (!workspace.snapshot_json)
      throw new HttpError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace cannot update agents.",
      );
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    this.storage.transactionSync(() => {
      this.secrets.writePrepared(prepared);
      this.secrets.writePrepared(preparedDeliverySigningSecret);
      this.storage.sql.exec(
        "UPDATE external_agent_runtimes SET token_hash = ?, delivery_signing_key_id = ?, delivery_signing_secret_ref = ?, connection_status = 'pending_setup', updated_at = ? WHERE agent_id = ?",
        tokenHash,
        deliverySigningKeyId,
        deliverySigningSecretRef,
        new Date().toISOString(),
        agentId,
      );
      this.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify({
          ...snapshot,
          agents: snapshot.agents.map((agent) =>
            agent.id === agentId && agent.runtime.kind === "external-channel"
              ? {
                  ...agent,
                  runtime: {
                    ...agent.runtime,
                    connectionStatus: "pending_setup",
                  },
                }
              : agent,
          ),
        }),
      );
      if (
        runtime.delivery_signing_secret_ref &&
        runtime.delivery_signing_secret_ref !== deliverySigningSecretRef
      )
        this.secrets.delete(
          context.workspaceId,
          runtime.delivery_signing_secret_ref,
        );
    });
    const stored = z
      .object({ channel: z.object({ inboundUrl: z.url() }) })
      .parse(JSON.parse(runtime.registration_result_json));
    return json(
      externalAgentCredentialRotationResultSchema.parse({
        channel: {
          token,
          inboundUrl: stored.channel.inboundUrl,
          deliverySigningKeyId,
          deliverySigningSecret,
        },
      }),
    );
  }
}
