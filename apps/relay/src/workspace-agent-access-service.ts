import type { Principal } from "@chief/relay-contracts";
import {
  agentConfigSchema,
  agentIdSchema,
  agentSummarySchema,
  createNativeAgentCommandSchema,
  isJsonObject,
  parseJsonObject,
} from "@chief/relay-contracts";

import type { AgentConfigRow } from "./workspace-channel-store";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
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
      this.storage.sql.exec(
        "INSERT INTO members (principal_kind, principal_id, role, created_at) VALUES ('agent', ?, 'member', ?)",
        agent.id,
        now,
      );
      this.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify({ ...snapshot, agents: [...snapshot.agents, agent] }),
      );
    });
    return json({ agent });
  }

  configGet(request: Request) {
    const context = readTrustedContext(request);
    this.requireConfigAccess(context.principal, false);
    const agentId = requestedAgentId(request);
    requireNativeAgent(this.storage, agentId);
    const row = firstRow<AgentConfigRow>(
      this.storage.sql.exec(
        "SELECT agent_id, config_json, updated_at FROM agent_configs WHERE agent_id = ?",
        agentId,
      ),
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
    this.storage.sql.exec(
      `INSERT INTO agent_configs (agent_id, config_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET config_json = excluded.config_json,
         updated_at = excluded.updated_at`,
      agentId,
      JSON.stringify(parsedConfig),
      updatedAt,
    );
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
    const directConversationIds = this.storage.sql
      .exec<{ conversation_id: string }>(
        `SELECT c.conversation_id FROM channels c
         INNER JOIN channel_members cm
           ON cm.conversation_id = c.conversation_id
         WHERE c.kind = 'direct'
           AND cm.principal_kind = 'agent'
           AND cm.principal_id = ?`,
        agentId,
      )
      .toArray()
      .map((row) => row.conversation_id);
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
        this.storage.sql.exec(
          "DELETE FROM channel_members WHERE conversation_id = ?",
          conversationId,
        );
        this.storage.sql.exec(
          "DELETE FROM channel_membership_events WHERE conversation_id = ?",
          conversationId,
        );
        this.storage.sql.exec(
          "DELETE FROM channel_membership_batches WHERE conversation_id = ?",
          conversationId,
        );
        this.storage.sql.exec(
          "DELETE FROM channels WHERE conversation_id = ?",
          conversationId,
        );
      }
      for (const removedAgentId of removedAgentIds) {
        this.storage.sql.exec(
          "DELETE FROM channel_members WHERE principal_kind = 'agent' AND principal_id = ?",
          removedAgentId,
        );
        this.storage.sql.exec(
          "DELETE FROM agent_keys WHERE agent_id = ?",
          removedAgentId,
        );
        this.storage.sql.exec(
          "DELETE FROM agent_configs WHERE agent_id = ?",
          removedAgentId,
        );
        this.storage.sql.exec(
          "DELETE FROM members WHERE principal_kind = 'agent' AND principal_id = ?",
          removedAgentId,
        );
      }
      for (const projectId of projectIds) {
        this.storage.sql.exec(
          "DELETE FROM projects WHERE project_id = ?",
          projectId,
        );
      }
      if (snapshot) {
        this.storage.sql.exec(
          "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
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
    const permission = request.headers.get("x-chief-required-permission");
    if (!isConversationPermission(permission)) {
      throw new HttpError(
        400,
        "missing_required_permission",
        "The internal conversation permission is required.",
      );
    }
    this.channels.requireAgentCapability(context.principal, permission);
    const conversationId = parseChannelId(
      new URL(request.url).searchParams.get("conversationId"),
    );
    this.channels.requireChannelVisible(conversationId, context.principal);
    const channel = this.channels.requireChannel(conversationId);
    if (
      permission === "messages.send" &&
      channel.kind === "direct" &&
      context.principal.kind === "user"
    ) {
      for (const member of this.channels.channelMemberRows(conversationId)) {
        if (member.kind === "agent")
          requireAgentMessageAccess(
            this.channels,
            member.principalId,
            context.principal,
          );
      }
    }
    return json({ ok: true });
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
