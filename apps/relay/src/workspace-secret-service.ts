import { z } from "zod";

import { secretNameSchema } from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { WorkspaceSecretStore } from "./workspace-secret-store";

const secretInputSchema = z.object({
  name: secretNameSchema,
  value: z.string().trim().min(1).max(20_000),
});

/**
 * Workspace-scoped secret CRUD. Every secret is entered against exactly one
 * workspace and is invisible to every other workspace. Only a workspace owner
 * can write or delete; any workspace member can read a secret by name, which
 * is what the hosted cells and local agents use to resolve inference
 * credentials.
 */
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
    this.requireMember(context);
    const name = requestedSecretName(request);
    const value = await this.store.get(context.workspaceId, name);
    if (value === null) {
      throw new HttpError(
        404,
        "secret_not_found",
        "The secret does not exist.",
      );
    }
    return json({ workspaceId: context.workspaceId, name, value });
  }

  list(request: Request) {
    const context = readTrustedContext(request);
    this.requireMember(context);
    const secrets = this.store.list(context.workspaceId);
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

  private requireOwner(principal: {
    kind: string;
    userId?: string;
    agentId?: string;
    service?: string;
  }) {
    if (principal.kind !== "user") {
      throw new HttpError(
        403,
        "secret_owner_required",
        "Only the workspace owner can manage secrets.",
      );
    }
    const role = this.channels.memberRole("user", principal.userId ?? "");
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
