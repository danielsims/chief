import type { ExternalAgentDeliveryCommand } from "@chief/relay-contracts";
import {
  externalAgentRegistrationResultSchema,
  registerExternalAgentCommandSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import {
  receiveExternalAgentActivity,
  receiveExternalAgentMessage,
} from "./external-agent-channel-inbound";
import {
  randomToken,
  requireVerifiedEveEndpoint,
  sha256,
} from "./external-agent-channel-security";
import { receiveExternalAgentTool } from "./external-agent-channel-tools";
import { ExternalAgentOutbox } from "./external-agent-outbox";
import { externalAgentRegistrationReplay } from "./external-agent-registration-result";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import {
  GitHubProjectRepository,
  projectRepository,
  ProjectRepositoryResolver,
} from "./project-repository";
import { externalAgentDefinitionsInsertRegister } from "./queries/external-agent-definitions/insert-register";
import { externalAgentDeploymentsInsertRegister } from "./queries/external-agent-deployments/insert-register";
import { externalAgentRuntimesFindRegister } from "./queries/external-agent-runtimes/find-register";
import { externalAgentRuntimesFindRuntime } from "./queries/external-agent-runtimes/find-runtime";
import { externalAgentRuntimesInsertRegister } from "./queries/external-agent-runtimes/insert-register";
import { externalAgentRuntimesUpdateUpdateEndpoint } from "./queries/external-agent-runtimes/update-update-endpoint";
import { membersInsertRegister } from "./queries/members/insert-register";
import { projectsFindRegister } from "./queries/projects/find-register";
import { workspaceUpdateVerifyConnection } from "./queries/workspace/update-verify-connection";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import { externalRuntimeOwner } from "./workspace-agent-runtime";
import { firstRow, WorkspaceChannelStore } from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";
import { WorkspaceSecretStore } from "./workspace-secret-store";

interface RuntimeRow extends Record<string, SqlStorageValue> {
  agent_id: string;
  connection_status: "pending_setup" | "connected" | "degraded";
  endpoint_url: string;
  token_hash: string;
  token_secret_ref: string;
  delivery_signing_key_id: string;
  delivery_signing_secret_ref: string;
  registration_command_id: string;
  registration_payload_hash: string;
  registration_result_json: string | null;
  replaces_native: number;
}

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
    this.repositories =
      repositories ??
      new ProjectRepositoryResolver(new GitHubProjectRepository(), storage);
  }

  async register(request: Request) {
    const context = readTrustedContext(request);
    requireWorkspaceAdministrator(this.channels, context.principal);
    const parsedCommand = registerExternalAgentCommandSchema.safeParse(
      await parseJson(request),
    );
    if (!parsedCommand.success) {
      const issue = parsedCommand.error.issues[0];
      const issuePath = issue?.path.join(".");
      const field = issuePath?.length ? issuePath : "request";
      throw new HttpError(
        400,
        "external_agent_registration_invalid",
        `Invalid agent deployment field "${field}": ${issue?.message ?? "Check the agent configuration."}`,
      );
    }
    const command = parsedCommand.data;
    requireVerifiedEveEndpoint(command.payload.endpoint);
    const payloadHash = await sha256(JSON.stringify(command.payload));
    const replay = firstRow<RuntimeRow>(
      externalAgentRuntimesFindRegister(this.storage, command.commandId),
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
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (!workspace.snapshot_json)
      throw new HttpError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace cannot register external agents.",
      );
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    const existingAgent = snapshot.agents.find(
      (agent) => agent.id === command.payload.agentId,
    );
    const replacesNative = Boolean(
      command.payload.replaceNative &&
      existingAgent?.runtime.kind === "native-cell",
    );
    const existingRuntime = this.runtime(command.payload.agentId);
    // Preparing a replacement deployment must not rotate credentials or redirect
    // traffic away from the connected deployment before its build succeeds.
    if (existingRuntime && command.payload.reuseExisting) {
      return await externalAgentRegistrationReplay(
        context.workspaceId,
        existingRuntime,
        this.secrets,
      );
    }
    if (
      existingRuntime?.replaces_native === 1 &&
      existingRuntime.connection_status !== "connected" &&
      replacesNative
    ) {
      externalAgentRuntimesUpdateUpdateEndpoint(this.storage, {
        endpointUrl: command.payload.endpoint,
        updatedAt: new Date().toISOString(),
        agentId: command.payload.agentId,
      });
      return await externalAgentRegistrationReplay(
        context.workspaceId,
        existingRuntime,
        this.secrets,
      );
    }
    if (
      existingRuntime ||
      (this.channels.memberRole("agent", command.payload.agentId) &&
        !replacesNative)
    )
      throw new HttpError(
        409,
        "agent_runtime_conflict",
        "This agent id already has a runtime.",
      );
    const definitionInput = command.payload.definition;
    if (
      definitionInput &&
      !firstRow(projectsFindRegister(this.storage, definitionInput.projectId))
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
    const agent = {
      ...(replacesNative && existingAgent
        ? existingAgent
        : {
            id: command.payload.agentId,
            name: command.payload.name,
            role: command.payload.role,
            description:
              command.payload.description ??
              `${command.payload.name} works with your team through Chief.`,
            instructions: command.payload.instructions,
            status: "idle" as const,
          }),
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
      agents: replacesNative ? snapshot.agents : [...snapshot.agents, agent],
    });
    const concurrentReplay = this.storage.transactionSync(() => {
      const claimed = firstRow<RuntimeRow>(
        externalAgentRuntimesFindRegister(this.storage, command.commandId),
      );
      if (claimed) return claimed;
      if (
        this.runtime(agent.id) ||
        (this.channels.memberRole("agent", agent.id) && !replacesNative)
      )
        throw new HttpError(
          409,
          "agent_runtime_conflict",
          "This agent id already has a runtime.",
        );
      this.secrets.writePrepared(preparedToken);
      this.secrets.writePrepared(preparedDeliverySigningSecret);
      externalAgentRuntimesInsertRegister(this.storage, {
        agentId: agent.id,
        endpointUrl: command.payload.endpoint,
        tokenHash: tokenHash,
        tokenSecretRef: tokenSecretRef,
        deliverySigningKeyId: deliverySigningKeyId,
        deliverySigningSecretRef: deliverySigningSecretRef,
        registrationCommandId: command.commandId,
        registrationPayloadHash: payloadHash,
        registrationResultJson: JSON.stringify({
          agent: result.agent,
          channel: {
            inboundUrl: result.channel.inboundUrl,
            deliverySigningKeyId,
          },
        }),
        replacesNative: replacesNative ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
      if (definition)
        externalAgentDefinitionsInsertRegister(this.storage, {
          agentId: agent.id,
          projectId: definition.projectId,
          repositoryId: definition.repositoryId,
          providerId: definition.repository.provider,
          repositoryIdentity:
            definition.repository.provider === "github"
              ? `${definition.repository.owner}/${definition.repository.name}`
              : definition.repository.repositoryId,
          path: definition.path,
          requestedRef: definition.requestedRef,
          verificationStatus: definition.verification.status,
          resolvedCommitSha:
            definition.verification.status === "verified"
              ? definition.verification.resolvedCommitSha
              : null,
          contentDigest:
            definition.verification.status === "verified"
              ? definition.verification.contentDigest
              : null,
        });
      externalAgentDeploymentsInsertRegister(this.storage, agent.id);
      if (!replacesNative) {
        membersInsertRegister(this.storage, agent.id, now);
      }
      workspaceUpdateVerifyConnection(
        this.storage,
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
    return receiveExternalAgentMessage(this.inboundHost(), request, rawAgentId);
  }

  async receiveActivity(request: Request, rawAgentId: string) {
    return receiveExternalAgentActivity(
      this.inboundHost(),
      request,
      rawAgentId,
    );
  }

  async receiveTools(request: Request, rawAgentId: string) {
    return receiveExternalAgentTool(this.inboundHost(), request, rawAgentId);
  }

  runtime(agentId: string) {
    return firstRow<RuntimeRow>(
      externalAgentRuntimesFindRuntime(this.storage, agentId),
    );
  }

  private inboundHost() {
    return {
      storage: this.storage,
      env: this.env,
      channels: this.channels,
      runtime: (agentId: string) =>
        this.runtime(externalRuntimeOwner(this.storage, agentId)),
    };
  }
}

function inboundUrl(request: Request, workspaceId: string, agentId: string) {
  return new URL(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/channel/messages`,
    request.url,
  ).toString();
}
