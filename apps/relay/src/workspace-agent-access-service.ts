import type { Principal } from "@chief/relay-contracts";
import {
  agentConfigSchema,
  agentIdSchema,
  isJsonObject,
  parseJsonObject,
} from "@chief/relay-contracts";

import type { AgentConfigRow } from "./workspace-channel-store";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { effectiveAgentConfigFor } from "./workspace-agent-config";
import {
  firstRow,
  parseChannelId,
  WorkspaceChannelStore,
} from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";

export class WorkspaceAgentAccessService {
  private readonly channels: WorkspaceChannelStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
  }

  configGet(request: Request) {
    const context = readTrustedContext(request);
    this.requireConfigAccess(context.principal, false);
    const agentId = requestedAgentId(request);
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
    const configInput = parseJsonObject(input.config);
    if (!configInput) {
      throw new HttpError(
        400,
        "invalid_agent_config",
        "Expected an agent configuration.",
      );
    }
    const parsedConfig = agentConfigSchema.parse(configInput);
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
    if (!this.channels.agentConfiguration(context.principal.agentId).enabled) {
      throw new HttpError(
        403,
        "agent_disabled",
        "This agent is disabled by workspace policy.",
      );
    }
    return json({ ok: true });
  }

  hostingContext(request: Request) {
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
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (!workspace.snapshot_json) {
      return json({ runtime: null, managed: false });
    }
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
    if (!agent) {
      throw new HttpError(
        404,
        "agent_not_found",
        "The hosted agent is not part of this workspace.",
      );
    }
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
