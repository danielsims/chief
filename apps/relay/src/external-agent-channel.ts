import type { ExternalAgentDeliveryCommand } from "@chief/relay-contracts";
import {
  agentIdSchema,
  appendMessageCommandSchema,
  appendMessageResultSchema,
  externalAgentInboundActivityResultSchema,
  externalAgentInboundActivitySchema,
  externalAgentInboundMessageSchema,
  externalAgentInboundResultSchema,
  externalAgentRegistrationResultSchema,
  registerExternalAgentCommandSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { dispatchAppendedMessage } from "./conversation-agent-dispatch";
import {
  deterministicUuid,
  randomToken,
  requireChannelToken,
  requireVerifiedEveEndpoint,
  sha256,
} from "./external-agent-channel-security";
import {
  externalConversationFetch,
  requireExternalThreadRoot,
} from "./external-agent-conversation";
import { ExternalAgentOutbox } from "./external-agent-outbox";
import { externalAgentRegistrationReplay } from "./external-agent-registration-result";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import {
  projectRepository,
  ProjectRepositoryResolver,
} from "./project-repository";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import { firstRow, WorkspaceChannelStore } from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";
import { WorkspaceSecretStore } from "./workspace-secret-store";

interface RuntimeRow extends Record<string, SqlStorageValue> {
  agent_id: string;
  endpoint_url: string;
  token_hash: string;
  token_secret_ref: string;
  delivery_signing_key_id: string;
  delivery_signing_secret_ref: string;
  registration_command_id: string;
  registration_payload_hash: string;
  registration_result_json: string | null;
}
interface ContinuationRow extends Record<string, SqlStorageValue> {
  conversation_id: string;
  thread_root_id: string | null;
  session_id: string;
}
interface ReceiptRow extends Record<string, SqlStorageValue> {
  payload_hash: string;
  message_id: string;
  status: "claimed" | "accepted";
}

const EXTERNAL_AGENT_PUBKEY = "0".repeat(64);
export class ExternalAgentChannelService {
  private readonly channels: WorkspaceChannelStore;
  private readonly outbox: ExternalAgentOutbox;
  private readonly secrets: WorkspaceSecretStore;
  private readonly repositories: ProjectRepositoryResolver;
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
    repositories?: ProjectRepositoryResolver,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
    this.outbox = new ExternalAgentOutbox(storage, env);
    this.secrets = new WorkspaceSecretStore(storage, env.RELAY_SECRET_KEY);
    this.repositories = repositories ?? new ProjectRepositoryResolver();
  }

  async register(request: Request) {
    const context = readTrustedContext(request);
    requireWorkspaceAdministrator(this.channels, context.principal);
    const command = registerExternalAgentCommandSchema.parse(
      await parseJson(request),
    );
    requireVerifiedEveEndpoint(command.payload.endpoint);
    const payloadHash = await sha256(JSON.stringify(command.payload));
    const replay = firstRow<RuntimeRow>(
      this.storage.sql.exec(
        "SELECT * FROM external_agent_runtimes WHERE registration_command_id = ?",
        command.commandId,
      ),
    );
    if (replay) {
      if (replay.registration_payload_hash !== payloadHash)
        throw new HttpError(
          409,
          "external_registration_command_conflict",
          "This command id was already used with a different registration.",
        );
      return externalAgentRegistrationReplay(
        context.workspaceId,
        replay,
        this.secrets,
      );
    }
    if (
      this.runtime(command.payload.agentId) ||
      this.channels.memberRole("agent", command.payload.agentId)
    )
      throw new HttpError(
        409,
        "agent_runtime_conflict",
        "This agent id already has a runtime.",
      );
    const definitionInput = command.payload.definition;
    if (
      definitionInput &&
      !firstRow(
        this.storage.sql.exec(
          "SELECT project_id FROM projects WHERE project_id = ?",
          definitionInput.projectId,
        ),
      )
    )
      throw new HttpError(
        404,
        "project_not_found",
        "The agent definition project does not exist in this workspace.",
      );

    const repository = definitionInput
      ? projectRepository(this.storage, definitionInput.projectId)
      : undefined;
    if (definitionInput && !repository)
      throw new HttpError(
        409,
        "project_repository_unavailable",
        "This Project does not have a GitHub or Chief Git repository source.",
      );
    const verification =
      definitionInput && repository
        ? await this.repositories
            .resolve(repository, definitionInput.path, definitionInput.ref)
            .catch((error: unknown) => ({
              status: "unresolved" as const,
              reason:
                error instanceof Error
                  ? `Chief could not verify this revision: ${error.message}`
                  : "Chief could not verify this revision.",
            }))
        : undefined;
    const definition =
      definitionInput && repository && verification
        ? {
            kind: "repository" as const,
            projectId: definitionInput.projectId,
            repositoryId: repository.id,
            repository: repository.provider,
            path: definitionInput.path,
            requestedRef: definitionInput.ref,
            verification,
          }
        : undefined;
    const token = randomToken();
    const deliverySigningKeyId = `dsk_${crypto.randomUUID()}`;
    const deliverySigningSecret = randomToken();
    const tokenSecretRef = `external-agent.${command.payload.agentId}.channel`;
    const deliverySigningSecretRef = `external-agent.${command.payload.agentId}.delivery-signing.${deliverySigningKeyId}`;
    const preparedToken = await this.secrets.prepare(
      context.workspaceId,
      tokenSecretRef,
      token,
    );
    const tokenHash = await sha256(token);
    const preparedDeliverySigningSecret = await this.secrets.prepare(
      context.workspaceId,
      deliverySigningSecretRef,
      deliverySigningSecret,
    );
    const now = new Date().toISOString();
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (!workspace.snapshot_json)
      throw new HttpError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace cannot register external agents.",
      );
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    const agent = {
      id: command.payload.agentId,
      name: command.payload.name,
      role: command.payload.role,
      description:
        command.payload.description ??
        `${command.payload.name} works with your team through Chief.`,
      instructions: command.payload.instructions,
      status: "idle" as const,
      runtime: {
        kind: "external-channel" as const,
        provider: "eve" as const,
        endpoint: command.payload.endpoint,
        connectionStatus: "pending_setup" as const,
        definition,
        deployment: { status: "unattested" as const },
      },
    };
    const result = externalAgentRegistrationResultSchema.parse({
      agent,
      channel: {
        token,
        inboundUrl: inboundUrl(request, context.workspaceId, agent.id),
        deliverySigningKeyId,
        deliverySigningSecret,
      },
    });
    const nextSnapshot = workspaceSnapshotSchema.parse({
      ...snapshot,
      agents: [...snapshot.agents, agent],
    });
    const concurrentReplay = this.storage.transactionSync(() => {
      const claimed = firstRow<RuntimeRow>(
        this.storage.sql.exec(
          "SELECT * FROM external_agent_runtimes WHERE registration_command_id = ?",
          command.commandId,
        ),
      );
      if (claimed) return claimed;
      if (this.runtime(agent.id) || this.channels.memberRole("agent", agent.id))
        throw new HttpError(
          409,
          "agent_runtime_conflict",
          "This agent id already has a runtime.",
        );
      this.secrets.writePrepared(preparedToken);
      this.secrets.writePrepared(preparedDeliverySigningSecret);
      this.storage.sql.exec(
        `INSERT INTO external_agent_runtimes (agent_id, endpoint_url, token_hash, token_secret_ref, delivery_signing_key_id, delivery_signing_secret_ref, registration_command_id, registration_payload_hash, registration_result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        agent.id,
        command.payload.endpoint,
        tokenHash,
        tokenSecretRef,
        deliverySigningKeyId,
        deliverySigningSecretRef,
        command.commandId,
        payloadHash,
        JSON.stringify({
          agent: result.agent,
          channel: {
            inboundUrl: result.channel.inboundUrl,
            deliverySigningKeyId,
          },
        }),
        now,
        now,
      );
      if (definition)
        this.storage.sql.exec(
          `INSERT INTO external_agent_definitions (agent_id, project_id, repository_id, provider_id, repository_identity, path, requested_ref, verification_status, resolved_commit_sha, content_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          agent.id,
          definition.projectId,
          definition.repositoryId,
          definition.repository.provider,
          definition.repository.provider === "github"
            ? `${definition.repository.owner}/${definition.repository.name}`
            : definition.repository.repositoryId,
          definition.path,
          definition.requestedRef,
          definition.verification.status,
          definition.verification.status === "verified"
            ? definition.verification.resolvedCommitSha
            : null,
          definition.verification.status === "verified"
            ? definition.verification.contentDigest
            : null,
        );
      this.storage.sql.exec(
        "INSERT INTO external_agent_deployments (agent_id, status) VALUES (?, 'unattested')",
        agent.id,
      );
      this.storage.sql.exec(
        "INSERT INTO members (principal_kind, principal_id, role, created_at) VALUES ('agent', ?, 'member', ?)",
        agent.id,
        now,
      );
      this.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify(nextSnapshot),
      );
      return undefined;
    });
    if (concurrentReplay) {
      if (concurrentReplay.registration_payload_hash !== payloadHash)
        throw new HttpError(
          409,
          "external_registration_command_conflict",
          "This command id was already used with a different registration.",
        );
      return await externalAgentRegistrationReplay(
        context.workspaceId,
        concurrentReplay,
        this.secrets,
      );
    }
    return json(result, { status: 201 });
  }

  async enqueue(
    workspaceId: string,
    agentId: string,
    command: ExternalAgentDeliveryCommand,
    conversationId: string,
    threadRootId?: string,
  ) {
    return this.outbox.enqueue(
      workspaceId,
      agentId,
      command,
      conversationId,
      threadRootId,
    );
  }

  async drain(workspaceId: string) {
    return this.outbox.drain(workspaceId);
  }

  async receive(request: Request, rawAgentId: string) {
    const context = readTrustedContext(request);
    const agentId = agentIdSchema.parse(rawAgentId);
    const runtime = this.runtime(agentId);
    if (!runtime)
      throw new HttpError(
        404,
        "external_agent_not_found",
        "This external agent is not registered.",
      );
    await requireChannelToken(request, runtime.token_hash);
    const input = externalAgentInboundMessageSchema.parse(
      await parseJson(request),
    );
    const continuation = firstRow<ContinuationRow>(
      this.storage.sql.exec(
        `SELECT conversation_id, thread_root_id, session_id FROM external_agent_outbox WHERE agent_id = ? AND capability_hash = ? AND status = 'accepted'`,
        agentId,
        await sha256(input.continuation.capability),
      ),
    );
    if (!continuation || continuation.session_id !== input.sessionId)
      throw new HttpError(
        403,
        "external_continuation_invalid",
        "This continuation was not issued to this agent session.",
      );
    const payloadHash = await sha256(JSON.stringify(input));
    const messageId = await deterministicUuid(
      `${context.workspaceId}:${agentId}:external:${input.deliveryId}`,
    );
    const receipt = firstRow<ReceiptRow>(
      this.storage.sql.exec(
        "SELECT * FROM external_agent_inbound_receipts WHERE agent_id = ? AND delivery_id = ?",
        agentId,
        input.deliveryId,
      ),
    );
    if (receipt && receipt.payload_hash !== payloadHash)
      throw new HttpError(
        409,
        "external_delivery_conflict",
        "This delivery id was already used with different content.",
      );
    if (receipt?.status === "accepted")
      return json(
        externalAgentInboundResultSchema.parse({
          duplicate: true,
          messageId: receipt.message_id,
        }),
      );
    const now = new Date().toISOString();
    if (!receipt)
      this.storage.sql.exec(
        `INSERT INTO external_agent_inbound_receipts (agent_id, delivery_id, payload_hash, message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'claimed', ?, ?)`,
        agentId,
        input.deliveryId,
        payloadHash,
        messageId,
        now,
        now,
      );
    const principal = {
      kind: "agent" as const,
      agentId,
      pubkey: EXTERNAL_AGENT_PUBKEY,
      workspaceId: context.workspaceId,
      role: "member" as const,
    };
    this.channels.requirePrincipalMember(principal);
    this.channels.requireAgentCapability(principal, "messages.send");
    this.channels.requireChannelVisible(
      continuation.conversation_id,
      principal,
    );
    await requireExternalThreadRoot(
      this.env,
      context.workspaceId,
      continuation,
      principal,
      context.requestId,
    );
    const command = appendMessageCommandSchema.parse({
      commandId: messageId,
      protocolVersion: 1,
      occurredAt: now,
      payload: {
        messageId,
        conversationId: continuation.conversation_id,
        threadRootId: continuation.thread_root_id ?? undefined,
        body: input.body,
        mentions: [],
        components: [],
      },
    });
    const appendRequest = new Request("https://relay.internal/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    const response = await externalConversationFetch(
      this.env,
      context.workspaceId,
      continuation.conversation_id,
      appendRequest,
      principal,
      context.requestId,
    );
    if (!response.ok) return response;
    const result = appendMessageResultSchema.parse(
      await response.clone().json(),
    );
    const dispatched = await dispatchAppendedMessage(this.env, {
      request: appendRequest,
      response,
      principal,
      requestId: context.requestId,
      workspaceId: context.workspaceId,
      conversationId: continuation.conversation_id,
    });
    if (!dispatched.ok) return dispatched;
    await releaseInternalResponse(dispatched);
    this.storage.sql.exec(
      "UPDATE external_agent_inbound_receipts SET status = 'accepted', updated_at = ? WHERE agent_id = ? AND delivery_id = ?",
      new Date().toISOString(),
      agentId,
      input.deliveryId,
    );
    return json(
      externalAgentInboundResultSchema.parse({
        duplicate: result.duplicate,
        messageId: result.message.id,
      }),
    );
  }

  async receiveActivity(request: Request, rawAgentId: string) {
    const context = readTrustedContext(request);
    const agentId = agentIdSchema.parse(rawAgentId);
    const runtime = this.runtime(agentId);
    if (!runtime)
      throw new HttpError(
        404,
        "external_agent_not_found",
        "This external agent is not registered.",
      );
    await requireChannelToken(request, runtime.token_hash);
    const input = externalAgentInboundActivitySchema.parse(
      await parseJson(request),
    );
    const continuation = firstRow<ContinuationRow>(
      this.storage.sql.exec(
        `SELECT conversation_id, thread_root_id, session_id FROM external_agent_outbox WHERE agent_id = ? AND capability_hash = ? AND status = 'accepted'`,
        agentId,
        await sha256(input.continuation.capability),
      ),
    );
    if (!continuation || continuation.session_id !== input.sessionId)
      throw new HttpError(
        403,
        "external_continuation_invalid",
        "This continuation was not issued to this agent session.",
      );
    const messageId = await deterministicUuid(
      `${context.workspaceId}:${agentId}:external:${input.deliveryId}:activity:${input.component.id}`,
    );
    const principal = {
      kind: "agent" as const,
      agentId,
      pubkey: EXTERNAL_AGENT_PUBKEY,
      workspaceId: context.workspaceId,
      role: "member" as const,
    };
    const response = await externalConversationFetch(
      this.env,
      context.workspaceId,
      continuation.conversation_id,
      new Request(
        `https://relay.internal/messages/${encodeURIComponent(messageId)}/activity`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messageId,
            conversationId: continuation.conversation_id,
            ...(continuation.thread_root_id
              ? { threadRootId: continuation.thread_root_id }
              : undefined),
            component: input.component,
          }),
        },
      ),
      principal,
      context.requestId,
    );
    if (!response.ok) return response;
    await releaseInternalResponse(response);
    return json(externalAgentInboundActivityResultSchema.parse({ messageId }));
  }

  runtime(agentId: string) {
    return firstRow<RuntimeRow>(
      this.storage.sql.exec(
        "SELECT * FROM external_agent_runtimes WHERE agent_id = ?",
        agentId,
      ),
    );
  }
}

function inboundUrl(request: Request, workspaceId: string, agentId: string) {
  return new URL(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/channel/messages`,
    request.url,
  ).toString();
}
