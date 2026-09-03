import type { EveAgentProvisioningStreamEvent } from "@chief/relay-contracts";
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
  vercelConnectCommandSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { mintAiGatewayKey } from "./workspace-ai-gateway";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { saveAgentProjectFiles } from "./workspace-project-store";
import { WorkspaceSecretStore } from "./workspace-secret-store";

const VERCEL_DEPLOYMENT_SECRET = "vercel-deployment";

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
    await this.secrets.set(
      context.workspaceId,
      VERCEL_DEPLOYMENT_SECRET,
      token,
    );
    if (!(await this.secrets.get(context.workspaceId, "vercel-ai-gateway"))) {
      const teamId = catalog.selectedTeamId ?? catalog.teams[0]?.id;
      const key = await mintAiGatewayKey(
        token,
        teamId,
        "Chief hosted agents",
      ).catch(() => token);
      await this.secrets.set(context.workspaceId, "vercel-ai-gateway", key);
    }
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
    const token = await this.vercelToken(context.workspaceId);
    const sourceFiles = eveProjectFiles(input);
    const encoder = new TextEncoder();
    const storage = this.storage;
    const workspaceId = context.workspaceId;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: EveAgentProvisioningStreamEvent) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        try {
          const repo = chiefGitRepoSlug(input.project.projectName);
          const remoteUrl = chiefGitRemoteUrl(
            input.environment.CHIEF_RELAY_URL,
            workspaceId,
            repo,
          );
          saveAgentProjectFiles(storage, workspaceId, {
            agentId: input.environment.CHIEF_AGENT_ID,
            name: input.project.projectName,
            description: input.agent.description,
            files: sourceFiles,
            canonicalRemoteUrl: remoteUrl,
          });
          const result = await provisionVercelEveDeployment({
            token,
            input,
            sourceFiles,
            git: { remoteUrl },
            pollIntervalMs: 8_000,
            onProgress: (progress) => send({ kind: "progress", progress }),
          });
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
