import type { McpConnection } from "@chief/relay-contracts";

import { HttpError } from "../http";
import { WorkspaceChannelStore } from "../workspace-channel-store";
import { pendingMcpSignIn } from "./oauth-support";

/** Agent consent uses the same ownership and integrations as agent settings. */
export class McpAgentAccess {
  private readonly channels: WorkspaceChannelStore;
  constructor(
    private readonly storage: DurableObjectStorage,
    env: Env,
    private readonly workspaceId: string,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
  }
  async pendingStart(startToken: string) {
    const request = await pendingMcpSignIn(this.storage, startToken);
    this.requireAdministrator(request.user_id);
    return request;
  }

  requireAdministrator(userId: string) {
    const role = this.channels.memberRole("user", userId);
    if (role !== "owner" && role !== "admin")
      throw new HttpError(
        403,
        "plugin_sign_in_denied",
        "Only a workspace owner or admin can connect plugins. Start again from Chief.",
      );
  }

  describe(connection: McpConnection, authorizationUrl: string) {
    const workspace = this.channels.requireWorkspace(this.workspaceId);
    return {
      pluginName: connection.name,
      domain: new URL(connection.url).hostname,
      logoDomain: connection.domain ?? new URL(connection.url).hostname,
      signInHost: new URL(authorizationUrl).hostname,
      workspaceName: workspace.name,
    };
  }
}
