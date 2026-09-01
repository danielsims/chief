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
    const result = await this.vercelRequest(
      "vercel_provision_failed",
      "Chief could not deploy this agent to Vercel Eve.",
      () => provisionVercelEveDeployment({ token, input }),
    );
    saveAgentProjectFiles(this.storage, context.workspaceId, {
      agentId: input.environment.CHIEF_AGENT_ID,
      name: input.project.projectName,
      description: input.agent.description,
      files: eveProjectFiles(input),
    });
    return json(result);
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
