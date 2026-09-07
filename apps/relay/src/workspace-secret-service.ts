import { z } from "zod";

import type { AgentConfig, Principal } from "@chief/relay-contracts";
import { secretNameSchema } from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { WorkspaceSecretStore } from "./workspace-secret-store";

const secretInputSchema = z.object({
  name: secretNameSchema,
  value: z.string().trim().min(1).max(20_000),
});

const internalSecret = (name: string) =>
  name === "vercel-deployment" || name.startsWith("external-agent.");

function grantedSecret(config: AgentConfig) {
  if (!config.enabled || !("secretRef" in config.inference)) return undefined;
  const name = config.inference.secretRef;
  return name && !internalSecret(name) ? name : undefined;
}
export class WorkspaceSecretService {
  private readonly channels: WorkspaceChannelStore;
  private readonly store: WorkspaceSecretStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
    this.store = new WorkspaceSecretStore(storage, env.RELAY_SECRET_KEY);
  }

  async set(request: Request) {
    const context = readTrustedContext(request);
    this.requireOwner(context.principal);
    const input = secretInputSchema.parse(await parseJson(request));
    await this.store.set(context.workspaceId, input.name, input.value);
    return json({ workspaceId: context.workspaceId, name: input.name });
  }

  async get(request: Request) {
    const context = readTrustedContext(request);
    const config = this.requireAgent(context);
    const name = requestedSecretName(request);
    if (grantedSecret(config) !== name)
      throw new HttpError(
        403,
        "secret_access_denied",
        "This agent is not granted access to this secret.",
      );
    const value = await this.store.get(context.workspaceId, name);
    if (value === null) {
      throw new HttpError(
        404,
        "secret_not_found",
        "The secret does not exist.",
      );
    }
    if (
      value === (await this.store.get(context.workspaceId, "vercel-deployment"))
    )
      throw new HttpError(
        403,
        "secret_infrastructure_credential",
        "A deployment credential cannot be used as an agent API key.",
      );
    return json(
      { workspaceId: context.workspaceId, name, value },
      { headers: { "cache-control": "no-store" } },
    );
  }

  list(request: Request) {
    const context = readTrustedContext(request);
    this.requireMember(context);
    const grant =
      context.principal.kind === "agent"
        ? grantedSecret(this.requireAgent(context))
        : undefined;
    const secrets = this.store
      .list(context.workspaceId)
      .filter(
        (secret) => context.principal.kind !== "agent" || secret.name === grant,
      );
    return json({ workspaceId: context.workspaceId, secrets });
  }

  delete(request: Request) {
    const context = readTrustedContext(request);
    this.requireOwner(context.principal);
    const name = requestedSecretName(request);
    this.store.delete(context.workspaceId, name);
    return json({ workspaceId: context.workspaceId, name, deleted: true });
  }

  private requireMember(context: ReturnType<typeof readTrustedContext>) {
    this.channels.requirePrincipalMember(context.principal);
  }

  private requireAgent(context: ReturnType<typeof readTrustedContext>) {
    if (context.principal.kind !== "agent") {
      throw new HttpError(
        403,
        "secret_agent_required",
        "Only an agent running in this workspace can read secret values.",
      );
    }
    this.requireMember(context);
    const config = this.channels.agentConfiguration(context.principal.agentId);
    if (!config.enabled)
      throw new HttpError(403, "agent_disabled", "This agent is disabled.");
    return config;
  }

  private requireOwner(principal: Principal) {
    if (principal.kind !== "user") {
      throw new HttpError(
        403,
        "secret_owner_required",
        "Only the workspace owner can manage secrets.",
      );
    }
    const role = this.channels.memberRole("user", principal.userId);
    if (role !== "owner") {
      throw new HttpError(
        403,
        "secret_owner_required",
        "Only the workspace owner can manage secrets.",
      );
    }
  }
}

function requestedSecretName(request: Request) {
  const name = new URL(request.url).searchParams.get("name");
  if (name === null) {
    throw new HttpError(
      400,
      "missing_secret_name",
      "A secret name is required.",
    );
  }
  return secretNameSchema.parse(name);
}
