import { logBatchSchema, workspaceIdSchema } from "@chief/relay-contracts";

import { HttpError, json, parseJson, relayError } from "./http";
import { readTrustedIdentity } from "./internal-context";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { appendWorkspaceLogs, readWorkspaceLogs } from "./workspace-log-store";

export class WorkspaceLogService {
  private readonly channels: WorkspaceChannelStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
  }

  async record(request: Request) {
    const context = readTrustedIdentity(request);
    const batch = logBatchSchema.parse(await parseJson(request));
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    this.requireIdentityMember(context.identity);
    if (
      batch.logs.some((entry) => entry.workspaceId !== workspace.workspace_id)
    ) {
      return relayError(
        409,
        "workspace_mismatch",
        "Every log must belong to the routed workspace.",
      );
    }
    appendWorkspaceLogs(this.storage, batch);
    return json({ accepted: batch.logs.length });
  }

  list(request: Request) {
    const context = readTrustedIdentity(request);
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    this.requireIdentityMember(context.identity);
    return json(
      readWorkspaceLogs(
        this.storage,
        workspaceIdSchema.parse(workspace.workspace_id),
        new URL(request.url),
      ),
    );
  }

  private requireIdentityMember(
    identity: ReturnType<typeof readTrustedIdentity>["identity"],
  ) {
    const id =
      identity.kind === "user"
        ? identity.userId
        : identity.kind === "agent"
          ? identity.agentId
          : identity.service;
    if (!this.channels.memberRole(identity.kind, id)) {
      throw new HttpError(
        403,
        "workspace_access_denied",
        "This identity is not a workspace member.",
      );
    }
  }
}
