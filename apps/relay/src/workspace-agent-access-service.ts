import type { Principal } from "@chief/relay-contracts";
import {
  agentAvatarSetSchema,
  agentConfigSchema,
  agentIdSchema,
  agentSummarySchema,
  createNativeAgentCommandSchema,
  isJsonObject,
  parseJsonObject,
} from "@chief/relay-contracts";

import type { AgentConfigRow } from "./workspace-channel-store";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext, readTrustedIdentity } from "./internal-context";
import { agentConfigsDeleteRemove } from "./queries/agent-configs/delete-remove";
import { agentConfigsFindConfigGet } from "./queries/agent-configs/find-config-get";
import { agentConfigsInsertConfigSet } from "./queries/agent-configs/insert-config-set";
import { agentConfigsListAll } from "./queries/agent-configs/list-all";
import { agentKeysDeleteRemove } from "./queries/agent-keys/delete-remove";
import { channelMembersDeleteRemove } from "./queries/channel-members/delete-remove";
import { channelMembersDeleteRemoveRow } from "./queries/channel-members/delete-remove-row";
import { channelMembershipBatchesDeleteRemove } from "./queries/channel-membership-batches/delete-remove";
import { channelMembershipEventsDeleteRemove } from "./queries/channel-membership-events/delete-remove";
import { channelsDeleteRemove } from "./queries/channels/delete-remove";
import { channelsFindAgentDirects } from "./queries/channels/find-agent-directs";
import { externalAgentRuntimesListAgentIds } from "./queries/external-agent-runtimes/list-agent-ids";
import { membersDeleteDisconnect } from "./queries/members/delete-disconnect";
import { membersInsertRegister } from "./queries/members/insert-register";
import { projectsDeleteRemove } from "./queries/projects/delete-remove";
import { workspaceUpdateVerifyConnection } from "./queries/workspace/update-verify-connection";
import { WorkspaceAccessService } from "./workspace-access-service";
import { effectiveAgentConfigFor } from "./workspace-agent-config";
import {
  requireAgentMessageAccess,
  requirePersonalAgentOwner,
} from "./workspace-agent-messaging";
import { requireNativeAgent, workspaceAgent } from "./workspace-agent-runtime";
import {
  firstRow,
  parseChannelId,
  WorkspaceChannelStore,
} from "./workspace-channel-store";
import { databasesForConversation } from "./workspace-databases";
import {
  decodeWorkspaceSnapshot,
  workspaceAgentProfiles,
} from "./workspace-defaults";
import { readMachines } from "./workspace-machine-store";
import {
  refreshMemberDisplayNames,
  workspacePeople,
} from "./workspace-member-names";
import { projectIdsOwnedByAgent } from "./workspace-project-store";

export class WorkspaceAgentAccessService {
  private readonly channels: WorkspaceChannelStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
  }

  async create(request: Request) {
    const context = readTrustedContext(request);
    this.requireConfigAccess(context.principal, true);
    const input = createNativeAgentCommandSchema.parse(
      await parseJson(request),
    );
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (!workspace.snapshot_json) {
      throw new HttpError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace cannot add agents yet.",
      );
    }
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    if (
      workspaceAgentProfiles(snapshot).some(
        (agent) => agent.id === input.agentId,
      )
    ) {
      throw new HttpError(409, "agent_exists", "This agent already exists.");
    }
    const agent = agentSummarySchema.parse({
      id: input.agentId,
      ownerUserId:
        context.principal.kind === "user"
          ? context.principal.userId
          : undefined,
      name: input.name,
      role: input.role,
      description: input.description,
      instructions: input.instructions,
      status: "idle",
      runtime: { kind: "native-cell" },
    });
    const now = new Date().toISOString();
    this.storage.transactionSync(() => {
      membersInsertRegister(this.storage, agent.id, now);
      workspaceUpdateVerifyConnection(
        this.storage,
        JSON.stringify({ ...snapshot, agents: [...snapshot.agents, agent] }),
      );
    });
    return json({ agent });
  }

  /** Sets or clears how an agent appears. The router has already checked that
   * an image or sprite is this agent's own upload. */
  async avatarSet(request: Request) {
    const context = readTrustedContext(request);
    this.requireConfigAccess(context.principal, true);
    const agentId = requestedAgentId(request);
    const { avatar } = agentAvatarSetSchema.parse(await parseJson(request));
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (!workspace.snapshot_json) {
      throw new HttpError(404, "agent_not_found", "This agent was not found.");
    }
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    const withAvatar = <Agent extends { id: string; avatar?: unknown }>(
      agent: Agent,
    ) => {
      if (agent.id !== agentId) return agent;
      const { avatar: _previous, ...rest } = agent;
      return avatar ? { ...rest, avatar } : rest;
    };
    if (
      !workspaceAgentProfiles(snapshot).some((agent) => agent.id === agentId)
    ) {
      throw new HttpError(404, "agent_not_found", "This agent was not found.");
    }
    workspaceUpdateVerifyConnection(
      this.storage,
      JSON.stringify({
        ...snapshot,
        agents: snapshot.agents.map((agent) => ({
          ...withAvatar(agent),
          subagents: agent.subagents.map(withAvatar),
        })),
      }),
    );
    return json({ agentId, avatar });
  }

  configGet(request: Request) {
    const context = readTrustedContext(request);
    this.requireConfigAccess(context.principal, false);
    const agentId = requestedAgentId(request);
    requireNativeAgent(this.storage, agentId);
    const row = firstRow<AgentConfigRow>(
      agentConfigsFindConfigGet(this.storage, agentId),
    );
    if (!row) {
      return json({
        agentId,
        config: this.channels.agentConfiguration(agentId),
        updatedAt: null,
      });
    }
    return json({
      agentId: agentIdSchema.parse(row.agent_id),
      config: effectiveAgentConfigFor(
        agentId,
        agentConfigSchema.parse(JSON.parse(row.config_json)),
      ),
      updatedAt: row.updated_at,
    });
  }

  /** Every native agent's configuration in one read, so a client refresh is
   * one request rather than one per agent. */
  configList(request: Request) {
    const context = readTrustedContext(request);
    this.requireConfigAccess(context.principal, false);
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    const snapshot = workspace.snapshot_json
      ? decodeWorkspaceSnapshot(workspace.snapshot_json)
      : undefined;
    const external = new Set(
      externalAgentRuntimesListAgentIds<{ agent_id: string }>(this.storage).map(
        (row) => row.agent_id,
      ),
    );
    const rows = new Map(
      agentConfigsListAll<AgentConfigRow>(this.storage).map((row) => [
        row.agent_id,
        row,
      ]),
    );
    const agentIds = (snapshot?.agents ?? [])
      .filter((agent) => agent.runtime.kind === "native-cell")
      .flatMap((agent) => [agent.id, ...agent.subagents.map(({ id }) => id)])
      .filter((agentId) => !external.has(agentId));
    return json({
      configs: agentIds.map((agentId) => {
        const row = rows.get(agentId);
        return row
          ? {
              agentId,
              config: effectiveAgentConfigFor(
                agentId,
                agentConfigSchema.parse(JSON.parse(row.config_json)),
              ),
              updatedAt: row.updated_at,
            }
          : {
              agentId,
              config: this.channels.agentConfiguration(agentId),
              updatedAt: null,
            };
      }),
    });
  }

  runtimeDescriptor(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    const agentId = requestedAgentId(request);
    const agent = workspaceAgent(this.storage, agentId);
    if (agent.runtime.kind === "external-channel") {
      return json({
        workspaceId: context.workspaceId,
        agentId,
        address: agent.runtime.endpoint,
        runtime: agent.runtime,
        status: "ready",
        deploymentTarget: null,
        computer: null,
      });
    }
    const config = this.channels.agentConfiguration(agentId);
    const address = new URL(
      `/v1/workspaces/${encodeURIComponent(context.workspaceId)}/agents/${encodeURIComponent(agentId)}`,
      request.url,
    ).toString();
    return json({
      workspaceId: context.workspaceId,
      agentId,
      address,
      deploymentTarget: config.deploymentTarget,
      status: !config.enabled
        ? "disabled"
        : config.deploymentTarget === "cloud"
          ? "ready"
          : "waiting",
      computer:
        config.deploymentTarget === "cloud"
          ? "cloudflare-worker"
          : "local-celld",
    });
  }

  async configSet(request: Request) {
    const context = readTrustedContext(request);
    this.requireConfigAccess(context.principal, true);
    const input = await parseJson(request);
    if (!isJsonObject(input)) {
      throw new HttpError(400, "invalid_request", "Expected a JSON object.");
    }
    const agentId = agentIdSchema.parse(input.agentId);
    requireNativeAgent(this.storage, agentId);
    requireAgentMessageAccess(this.channels, agentId, context.principal);
    const configInput = parseJsonObject(input.config);
    if (!configInput) {
      throw new HttpError(
        400,
        "invalid_agent_config",
        "Expected an agent configuration.",
      );
    }
    const parsedConfig = agentConfigSchema.parse(configInput);
    if (
      this.channels.agentConfiguration(agentId).deploymentTarget !== "cloud" ||
      parsedConfig.deploymentTarget !== "cloud"
    ) {
      requirePersonalAgentOwner(this.channels, agentId, context.principal);
    }
    const updatedAt = new Date().toISOString();
    agentConfigsInsertConfigSet(this.storage, {
      agentId: agentId,
      configJson: JSON.stringify(parsedConfig),
      updatedAt: updatedAt,
    });
    return json({ agentId, config: parsedConfig, updatedAt });
  }

  remove(request: Request) {
    const context = readTrustedContext(request);
    this.requireConfigAccess(context.principal, true);
    const agentId = requestedAgentId(request);
    if (this.channels.agentConfiguration(agentId).deploymentTarget !== "cloud")
      requirePersonalAgentOwner(this.channels, agentId, context.principal);
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    const snapshot = workspace.snapshot_json
      ? decodeWorkspaceSnapshot(workspace.snapshot_json)
      : null;
    const rootAgent = snapshot?.agents.find((agent) => agent.id === agentId);
    const nestedAgent = snapshot?.agents
      .flatMap((agent) => agent.subagents)
      .find((agent) => agent.id === agentId);
    if (nestedAgent) {
      throw new HttpError(
        409,
        "subagent_owned_by_root",
        "This subagent is managed through its root agent.",
      );
    }
    const existsInSnapshot = rootAgent !== undefined;
    if (
      !existsInSnapshot &&
      this.channels.memberRole("agent", agentId) === null
    ) {
      throw new HttpError(404, "agent_not_found", "The agent does not exist.");
    }
    const directConversationIds = channelsFindAgentDirects<{
      conversation_id: string;
    }>(this.storage, agentId).map((row) => row.conversation_id);
    const projectIds = projectIdsOwnedByAgent(
      this.storage,
      context.workspaceId,
      agentId,
    );
    const removedAgentIds = [
      agentId,
      ...(rootAgent?.subagents.map((subagent) => subagent.id) ?? []),
    ];

    this.storage.transactionSync(() => {
      for (const conversationId of directConversationIds) {
        channelMembersDeleteRemove(this.storage, conversationId);
        channelMembershipEventsDeleteRemove(this.storage, conversationId);
        channelMembershipBatchesDeleteRemove(this.storage, conversationId);
        channelsDeleteRemove(this.storage, conversationId);
      }
      for (const removedAgentId of removedAgentIds) {
        channelMembersDeleteRemoveRow(this.storage, removedAgentId);
        agentKeysDeleteRemove(this.storage, removedAgentId);
        agentConfigsDeleteRemove(this.storage, removedAgentId);
        membersDeleteDisconnect(this.storage, removedAgentId);
      }
      for (const projectId of projectIds) {
        projectsDeleteRemove(this.storage, projectId);
      }
      if (snapshot) {
        workspaceUpdateVerifyConnection(
          this.storage,
          JSON.stringify({
            ...snapshot,
            agents: snapshot.agents.filter((agent) => agent.id !== agentId),
            conversations: snapshot.conversations.filter(
              (conversation) =>
                !directConversationIds.includes(conversation.id),
            ),
            projects: snapshot.projects.filter(
              (project) => !projectIds.includes(project.id),
            ),
          }),
        );
      }
    });
    return json({
      workspaceId: context.workspaceId,
      agentId,
      removed: true,
      directConversationIds,
    });
  }

  authorizeConversation(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    this.requireConversationAccess(request, context.principal);
    return json({ ok: true });
  }

  /** Resolves the identity and checks the conversation in one call, so a
   * conversation request costs one workspace round trip rather than two. */
  authorizeIdentityConversation(request: Request) {
    const { identity } = readTrustedIdentity(request);
    const principal = new WorkspaceAccessService(
      this.storage,
      this.env,
    ).principalFor(identity);
    if (!principal) {
      throw new HttpError(
        403,
        "workspace_access_denied",
        "This identity is not a workspace member.",
      );
    }
    this.requireConversationAccess(request, principal);
    return json({ principal });
  }

  private requireConversationAccess(request: Request, principal: Principal) {
    const permission = request.headers.get("x-chief-required-permission");
    if (!isConversationPermission(permission)) {
      throw new HttpError(
        400,
        "missing_required_permission",
        "The internal conversation permission is required.",
      );
    }
    this.channels.requireAgentCapability(principal, permission);
    const conversationId = parseChannelId(
      new URL(request.url).searchParams.get("conversationId"),
    );
    const channel = this.channels.requireChannelVisible(
      conversationId,
      principal,
    );
    if (
      permission === "messages.send" &&
      channel.kind === "direct" &&
      principal.kind === "user"
    ) {
      for (const member of this.channels.channelMemberRows(conversationId)) {
        if (member.kind === "agent")
          requireAgentMessageAccess(
            this.channels,
            member.principalId,
            principal,
          );
      }
    }
  }

  authorizeRuntime(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    if (context.principal.kind !== "agent") {
      throw new HttpError(
        403,
        "agent_required",
        "An agent identity is required for agent runtime access.",
      );
    }
    requireNativeAgent(this.storage, context.principal.agentId);
    if (!this.channels.agentConfiguration(context.principal.agentId).enabled) {
      throw new HttpError(
        403,
        "agent_disabled",
        "This agent is disabled by workspace policy.",
      );
    }
    return json({ ok: true });
  }

  authorizeNativeAgent(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    const agentId = requestedAgentId(request);
    requireNativeAgent(this.storage, agentId);
    requireAgentMessageAccess(this.channels, agentId, context.principal);
    return json({ ok: true });
  }

  async hostingContext(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    if (context.principal.kind !== "agent") {
      throw new HttpError(
        403,
        "agent_required",
        "An agent identity is required for hosted cell access.",
      );
    }
    const agentId = context.principal.agentId;
    requireNativeAgent(this.storage, agentId);
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (!workspace.snapshot_json) {
      return json({ runtime: null, managed: false });
    }
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    const agent = workspaceAgent(this.storage, agentId);
    await refreshMemberDisplayNames(this.storage, this.env);
    return json({
      managed: true,
      runtime: this.channels.agentConfiguration(agentId).deploymentTarget,
      workspace: {
        id: snapshot.id,
        name: snapshot.name,
        website: snapshot.website,
        selectedApps: snapshot.selectedApps,
      },
      agent,
      config: this.channels.agentConfiguration(agentId),
      machines: readMachines(this.storage, snapshot.id).filter(
        (machine) =>
          machine.status === "online" && machine.agentIds.includes(agentId),
      ),
      people: workspacePeople(this.storage),
      databases: databasesForConversation(this.storage).map((database) => ({
        id: database.id,
        name: database.name,
        channels: database.channels,
        fields: database.fields,
        views: database.views,
      })),
    });
  }

  private requireConfigAccess(principal: Principal, write: boolean) {
    const member = this.channels.requirePrincipalMember(principal);
    if (
      principal.kind !== "user" ||
      (member.role !== "owner" && member.role !== "admin")
    ) {
      throw new HttpError(
        403,
        write ? "agent_config_write_denied" : "agent_config_read_denied",
        "Only a workspace owner or admin can manage agent configuration.",
      );
    }
  }
}

function requestedAgentId(request: Request) {
  const rawAgentId = new URL(request.url).searchParams.get("agentId");
  if (!rawAgentId) {
    throw new HttpError(400, "missing_agent", "An agentId is required.");
  }
  return agentIdSchema.parse(rawAgentId);
}

function isConversationPermission(
  value: string | null,
): value is "messages.read" | "messages.send" | "messages.manage" {
  return (
    value === "messages.read" ||
    value === "messages.send" ||
    value === "messages.manage"
  );
}
