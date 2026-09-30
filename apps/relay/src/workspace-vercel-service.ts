import type {
  EveAgentProvisioningInput,
  EveAgentProvisioningProgress,
  EveAgentProvisioningStreamEvent,
} from "@chief/relay-contracts";
import {
  chiefGitRemoteUrl,
  chiefGitRepoSlug,
} from "@chief/agent-runtime/git-objects";
import {
  eveProjectFiles,
  listVercelEveDestinations,
  provisionVercelEveDeployment,
} from "@chief/agent-runtime/vercel-eve-provisioning";
import {
  eveAgentProvisioningInputSchema,
  eveAgentRedeployCommandSchema,
  vercelConnectCommandSchema,
} from "@chief/relay-contracts";

import { setExternalAgentEndpoint } from "./external-agent-administration";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { externalAgentRuntimesUpdateDeploymentIssue } from "./queries/external-agent-runtimes/update-deployment-issue";
import { projectsFindSaveAgentProjectFiles } from "./queries/projects/find-save-agent-project-files";
import { workspaceFindDrainExternalAgentOutbox } from "./queries/workspace/find-drain-external-agent-outbox";
import { mintAiGatewayKey } from "./workspace-ai-gateway";
import { firstRow, WorkspaceChannelStore } from "./workspace-channel-store";
import { externalAgentSnapshotRows } from "./workspace-external-agent-snapshot";
import { saveAgentProjectFiles } from "./workspace-project-store";
import { WorkspaceSecretStore } from "./workspace-secret-store";

const VERCEL_DEPLOYMENT_SECRET = "vercel-deployment";
const eveDeploymentSecret = (agentId: string) =>
  `external-agent.${agentId}.eve-deployment`;

export class WorkspaceVercelService {
  private readonly channels: WorkspaceChannelStore;
  private readonly secrets: WorkspaceSecretStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
    this.secrets = new WorkspaceSecretStore(storage, env.RELAY_SECRET_KEY);
  }

  async connect(request: Request) {
    const context = readTrustedContext(request);
    this.requireOwner(context.principal);
    const { token } = vercelConnectCommandSchema.parse(
      await parseJson(request),
    );
    const catalog = await this.vercelRequest(
      "vercel_connection_failed",
      "Chief could not validate this Vercel access token.",
      () => listVercelEveDestinations({ token }),
    );
    const previousToken = await this.secrets.get(
      context.workspaceId,
      VERCEL_DEPLOYMENT_SECRET,
    );
    const gatewayKey = await this.secrets.get(
      context.workspaceId,
      "vercel-ai-gateway",
    );
    if (!gatewayKey || gatewayKey === token || gatewayKey === previousToken) {
      const teamId = catalog.selectedTeamId ?? catalog.teams[0]?.id;
      const key = await this.vercelRequest(
        "vercel_gateway_key_failed",
        "Create an AI Gateway key before enabling hosted agents.",
        () => mintAiGatewayKey(token, teamId, "Chief hosted agents"),
      );
      if (key === token)
        throw new HttpError(
          400,
          "vercel_gateway_key_invalid",
          "Vercel must return a separate AI Gateway key.",
        );
      await this.secrets.set(context.workspaceId, "vercel-ai-gateway", key);
    }
    await this.secrets.set(
      context.workspaceId,
      VERCEL_DEPLOYMENT_SECRET,
      token,
    );
    return json(catalog);
  }

  async destinations(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    const token = await this.vercelToken(context.workspaceId);
    const teamId = new URL(request.url).searchParams.get("teamId")?.trim();
    const options: { token: string; teamId?: string } = { token };
    if (teamId) options.teamId = teamId;
    return json(
      await this.vercelRequest(
        "vercel_destinations_failed",
        "Chief could not load your Vercel teams and projects.",
        () => listVercelEveDestinations(options),
      ),
    );
  }

  async provision(request: Request) {
    const context = readTrustedContext(request);
    this.requireOwner(context.principal);
    const input = eveAgentProvisioningInputSchema.parse(
      await parseJson(request),
    );
    if (input.environment.CHIEF_WORKSPACE_ID !== context.workspaceId) {
      throw new HttpError(
        409,
        "vercel_workspace_mismatch",
        "The Eve deployment belongs to a different workspace.",
      );
    }
    return this.deployStream(context.workspaceId, input);
  }

  /** Redeploys an agent with the settings it was last deployed with. */
  async redeploy(request: Request) {
    const context = readTrustedContext(request);
    this.requireOwner(context.principal);
    const { agentId } = eveAgentRedeployCommandSchema.parse(
      await parseJson(request),
    );
    const input = await this.deployedInput(context.workspaceId, agentId);
    if (!input) {
      throw new HttpError(
        409,
        "eve_deployment_unknown",
        "Deploy this agent once so Chief knows its Vercel project.",
      );
    }
    return this.deployStream(context.workspaceId, input);
  }

  /** Redeploys every Eve agent whose generated project differs from what is live. */
  async updateOutdatedAgents(workspaceId: string) {
    for (const { agent_id: agentId } of externalAgentSnapshotRows(
      this.storage,
    )) {
      const input = await this.deployedInput(workspaceId, agentId);
      if (!input) {
        this.setDeploymentIssue(
          agentId,
          "This agent was deployed before Chief kept agents up to date. Redeploy it once from its settings.",
        );
        continue;
      }
      if (this.isCurrent(agentId, input)) continue;
      await this.deploy(workspaceId, input).catch((cause: unknown) => {
        const reason = cause instanceof Error ? cause.message : String(cause);
        this.setDeploymentIssue(
          agentId,
          `Chief could not update this agent's Vercel deployment: ${reason}`,
        );
      });
    }
  }

  private deployStream(workspaceId: string, input: EveAgentProvisioningInput) {
    const encoder = new TextEncoder();
    const deploy = this.deploy.bind(this);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: EveAgentProvisioningStreamEvent) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        try {
          const result = await deploy(workspaceId, input, (progress) =>
            send({ kind: "progress", progress }),
          );
          send({ kind: "complete", result });
        } catch (cause) {
          send({
            kind: "error",
            code: "vercel_provision_failed",
            message:
              cause instanceof Error
                ? cause.message
                : "Chief could not deploy this agent to Vercel Eve.",
          });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/x-ndjson; charset=utf-8",
      },
    });
  }

  private async deploy(
    workspaceId: string,
    input: EveAgentProvisioningInput,
    onProgress?: (progress: EveAgentProvisioningProgress) => void,
  ) {
    const token = await this.vercelToken(workspaceId);
    const agentId = input.environment.CHIEF_AGENT_ID;
    const sourceFiles = eveProjectFiles(input);
    const repo = chiefGitRepoSlug(input.project.projectName);
    const remoteUrl = chiefGitRemoteUrl(
      input.environment.CHIEF_RELAY_URL,
      workspaceId,
      repo,
    );
    const options: Parameters<typeof provisionVercelEveDeployment>[0] = {
      token,
      input,
      sourceFiles,
      git: { remoteUrl },
      pollIntervalMs: 8_000,
    };
    if (onProgress) options.onProgress = onProgress;
    const result = await provisionVercelEveDeployment(options);
    saveAgentProjectFiles(this.storage, workspaceId, {
      agentId,
      name: input.project.projectName,
      description: input.agent.description,
      files: sourceFiles,
      canonicalRemoteUrl: remoteUrl,
    });
    const deployed: EveAgentProvisioningInput = {
      ...input,
      project: {
        kind: "existing",
        projectId: result.projectId,
        projectName: input.project.projectName,
      },
    };
    await this.secrets.set(
      workspaceId,
      eveDeploymentSecret(agentId),
      JSON.stringify(deployed),
    );
    setExternalAgentEndpoint(
      this.storage,
      this.channels,
      workspaceId,
      agentId,
      new URL("/channels/chief/messages", result.productionUrl).toString(),
    );
    this.setDeploymentIssue(agentId, null);
    return result;
  }

  private setDeploymentIssue(agentId: string, issue: string | null) {
    externalAgentRuntimesUpdateDeploymentIssue(this.storage, {
      agentId,
      issue,
    });
  }

  private async deployedInput(workspaceId: string, agentId: string) {
    const saved = await this.secrets.get(
      workspaceId,
      eveDeploymentSecret(agentId),
    );
    return saved
      ? eveAgentProvisioningInputSchema.parse(JSON.parse(saved))
      : undefined;
  }

  private isCurrent(agentId: string, input: EveAgentProvisioningInput) {
    const project = firstRow<{ repository_files_json: string | null }>(
      projectsFindSaveAgentProjectFiles(this.storage, agentId),
    );
    const generated = eveProjectFiles(input).map((file) => ({
      path: file.path,
      content: file.contents,
    }));
    return project?.repository_files_json === JSON.stringify(generated);
  }

  private async vercelToken(workspaceId: string) {
    const token = await this.secrets.get(workspaceId, VERCEL_DEPLOYMENT_SECRET);
    if (!token) {
      throw new HttpError(
        409,
        "vercel_not_connected",
        "Connect Vercel before deploying an Eve agent.",
      );
    }
    return token;
  }

  private async vercelRequest<T>(
    code: string,
    fallbackMessage: string,
    request: () => Promise<T>,
  ): Promise<T> {
    try {
      return await request();
    } catch (cause) {
      if (cause instanceof HttpError) throw cause;
      throw new HttpError(
        400,
        code,
        cause instanceof Error ? cause.message : fallbackMessage,
      );
    }
  }

  private requireOwner(principal: {
    kind: string;
    userId?: string;
    agentId?: string;
    service?: string;
  }) {
    if (
      principal.kind !== "user" ||
      this.channels.memberRole("user", principal.userId ?? "") !== "owner"
    ) {
      throw new HttpError(
        403,
        "vercel_owner_required",
        "Only the workspace owner can manage its Vercel connection.",
      );
    }
  }
}

/** Brings every Eve agent in this workspace up to date with Chief's current template. */
export async function updateOutdatedEveAgents(
  storage: DurableObjectStorage,
  env: Env,
) {
  const workspace = firstRow<
    { workspace_id: string } & Record<string, SqlStorageValue>
  >(workspaceFindDrainExternalAgentOutbox(storage));
  if (!workspace) return;
  await new WorkspaceVercelService(storage, env).updateOutdatedAgents(
    workspace.workspace_id,
  );
}
