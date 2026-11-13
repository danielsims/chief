import type { McpConnectionAccess, Principal } from "@chief/relay-contracts";

import { HttpError } from "../http";
import { agentConfigsInsertConfigSet } from "../queries/agent-configs/insert-config-set";
import { WorkspaceChannelStore } from "../workspace-channel-store";
import { decodeWorkspaceSnapshot } from "../workspace-defaults";

/** This endpoint never writes inference, runtime, or another person's grants. */
export class PluginAgentAccessService {
  private readonly channels: WorkspaceChannelStore;
  constructor(
    private readonly storage: DurableObjectStorage,
    env: Env,
    private readonly workspaceId: string,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
  }

  list(principal: Principal, connectionId: string): McpConnectionAccess {
    this.channels.requirePrincipalMember(principal);
    if (principal.kind !== "user")
      throw new HttpError(
        403,
        "plugin_access_user_required",
        "Only a person can manage agent access.",
      );
    const workspace = this.channels.requireWorkspace(this.workspaceId);
    const roots = workspace.snapshot_json
      ? decodeWorkspaceSnapshot(workspace.snapshot_json).agents
      : [];
    const agents = roots.flatMap((parent) =>
      [parent, ...parent.subagents].map((agent) => {
        const config = this.channels.agentConfiguration(agent.id);
        const native = parent.runtime.kind === "native-cell";
        const owned =
          (agent.ownerUserId ??
            parent.ownerUserId ??
            workspace.created_by_user_id) === principal.userId;
        return {
          id: agent.id,
          name: agent.name,
          parentId: agent.id !== parent.id ? parent.id : undefined,
          deploymentTarget: config.deploymentTarget,
          canEdit: native && owned,
          reason: !native
            ? "Managed by its external runtime"
            : !owned
              ? "Only its owner can change access"
              : undefined,
        };
      }),
    );
    return {
      agents,
      assignedAgentIds: agents
        .filter((agent) =>
          this.channels
            .agentConfiguration(agent.id)
            .integrations.includes(connectionId),
        )
        .map((agent) => agent.id),
    };
  }

  update(
    principal: Principal,
    connectionId: string,
    agentIds: string[],
    enabled: boolean,
  ) {
    const roster = this.list(principal, connectionId);
    const chosen = [...new Set(agentIds)];
    // Authorize the entire batch before making any change.
    for (const id of chosen) {
      const agent = roster.agents.find((candidate) => candidate.id === id);
      if (!agent?.canEdit)
        throw new HttpError(
          403,
          "plugin_agent_owner_required",
          "You can change plugin access only for your own agents.",
        );
    }
    const updatedAt = new Date().toISOString();
    this.storage.transactionSync(() => {
      for (const id of chosen) {
        const config = this.channels.agentConfiguration(id);
        const integrations = new Set(config.integrations);
        if (enabled) integrations.add(connectionId);
        else integrations.delete(connectionId);
        agentConfigsInsertConfigSet(this.storage, {
          agentId: id,
          configJson: JSON.stringify({
            ...config,
            integrations: [...integrations],
          }),
          updatedAt,
        });
      }
    });
    return this.list(principal, connectionId);
  }
}
