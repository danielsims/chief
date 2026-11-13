import type {
  AgentAvatarSet,
  OwnedAgentUpdate,
  Principal,
} from "@chief/relay-contracts";
import {
  agentAvatarSchema,
  agentAvatarSetSchema,
  agentIdSchema,
  conversationIdSchema,
  ownedAgentChannelResultSchema,
  ownedAgentConnectCodeSchema,
  ownedAgentDecisionResultSchema,
  ownedAgentHandle,
  ownedAgentListSchema,
  ownedAgentProviderSchema,
  ownedAgentRequestListSchema,
  ownedAgentRevokedSchema,
  ownedAgentUpdateSchema,
} from "@chief/relay-contracts";

import type { OwnedAgentService } from "./owned-agent-service";
import type { MemberPrincipal } from "./owned-agent-shared";
import type { OwnedAgentRow } from "./queries/owned-agents/agents";
import type { ChannelRow } from "./workspace-channel-store";
import { randomToken, sha256 } from "./external-agent-channel-security";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import {
  closeOwnedAgentListeners,
  ownedAgentListenerCount,
} from "./owned-agent-listeners";
import {
  base64Url,
  CONNECT_CODE_LIFETIME_MS,
  maximumActiveCodesPerMember,
  maximumAgentsPerMember,
  OWNED_AGENT_GATEWAY_SERVICE,
  OWNED_AGENT_ORIGIN_HEADER,
} from "./owned-agent-shared";
import {
  ownedAgentAccessDelete,
  ownedAgentChannelsDelete,
  ownedAgentChannelsFind,
  ownedAgentChannelsInsert,
  ownedAgentsFind,
  ownedAgentsFindActiveByOwnerName,
  ownedAgentsFindByPubkey,
  ownedAgentsInsert,
  ownedAgentsListActive,
  ownedAgentsUpdate,
} from "./queries/owned-agents/agents";
import {
  ownedAgentChallengesDeleteForAgent,
  ownedAgentConnectCodesCountActive,
  ownedAgentConnectCodesInsert,
  ownedAgentConnectCodesInvalidateForUser,
  ownedAgentConnectPrune,
  ownedAgentRequestsFind,
  ownedAgentRequestsListPending,
  ownedAgentRequestsUpdate,
} from "./queries/owned-agents/connect";
import { WorkspaceChannelMembership } from "./workspace-channel-membership";
import { memberDisplayNames } from "./workspace-member-names";

export async function route(
  this: OwnedAgentService,
  request: Request,
  operation: string,
) {
  const context = readTrustedContext(request);
  const url = new URL(request.url);
  const origin = request.headers.get(OWNED_AGENT_ORIGIN_HEADER) ?? "";
  if (context.principal.kind === "service") {
    if (context.principal.service !== OWNED_AGENT_GATEWAY_SERVICE) {
      throw new HttpError(403, "forbidden", "This operation is not allowed.");
    }
    return this.routeAgent(request, operation, context.workspaceId, origin);
  }
  const member = this.requireMember(context.principal);
  switch (operation) {
    case "owned-agent-code-create":
      return json(await this.createConnectCode(member, origin), {
        status: 201,
      });
    case "owned-agent-code-invalidate":
      ownedAgentConnectCodesInvalidateForUser(
        this.storage,
        member.userId,
        new Date().toISOString(),
      );
      return json({ ok: true });
    case "owned-agent-request-list":
      return json(await this.pendingRequests(member));
    case "owned-agent-request-approve":
      return json(
        await this.decide(member, url.searchParams.get("requestId"), true),
      );
    case "owned-agent-request-on-device":
      return json(this.joinOnDevice(member, url.searchParams.get("requestId")));
    case "owned-agent-request-deny":
      return json(
        await this.decide(member, url.searchParams.get("requestId"), false),
      );
    case "owned-agent-list":
      return json(await this.list(member));
    case "owned-agent-update":
      return json(
        await this.update(
          member,
          url.searchParams.get("agentId"),
          ownedAgentUpdateSchema.parse(await parseJson(request)),
        ),
      );
    case "owned-agent-avatar-authorize":
      this.requireManagedAgent(member, url.searchParams.get("agentId"));
      return json({ ok: true });
    case "owned-agent-avatar-set":
      return json(
        this.setAvatar(
          member,
          url.searchParams.get("agentId"),
          agentAvatarSetSchema.parse(await parseJson(request)),
        ),
      );
    case "owned-agent-revoke":
      return json(this.revoke(member, url.searchParams.get("agentId")));
    case "owned-agent-channel-add":
      return json(
        await this.addToChannel(
          member,
          url.searchParams.get("agentId"),
          url.searchParams.get("conversationId"),
        ),
      );
    case "owned-agent-channel-remove":
      return json(
        this.removeFromChannel(
          member,
          url.searchParams.get("agentId"),
          url.searchParams.get("conversationId"),
        ),
      );
  }
  throw new HttpError(404, "not_found", "Owned agent operation not found.");
}

export function requireMember(
  this: OwnedAgentService,
  principal: Principal,
): MemberPrincipal {
  if (principal.kind !== "user") {
    throw new HttpError(
      403,
      "members_only",
      "Only a person in this workspace can manage owned agents.",
    );
  }
  this.channels.requirePrincipalMember(principal);
  return principal;
}

export async function createConnectCode(
  this: OwnedAgentService,
  member: MemberPrincipal,
  origin: string,
) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  ownedAgentConnectPrune(
    this.storage,
    nowIso,
    new Date(now - 24 * 60 * 60_000).toISOString(),
  );
  if (
    ownedAgentConnectCodesCountActive(this.storage, member.userId, nowIso) >=
    maximumActiveCodesPerMember
  ) {
    throw new HttpError(
      429,
      "connect_code_limit",
      "Too many connect codes are open. Wait for one to expire.",
    );
  }
  const code = randomToken();
  const expiresAt = new Date(now + CONNECT_CODE_LIFETIME_MS).toISOString();
  ownedAgentConnectCodesInsert(this.storage, {
    code_hash: await sha256(code),
    user_id: member.userId,
    created_at: nowIso,
    expires_at: expiresAt,
  });
  const payload = JSON.stringify({
    relay: origin,
    workspaceId: member.workspaceId,
    code,
  });
  const connectCode = base64Url(payload);
  return ownedAgentConnectCodeSchema.parse({
    connectCode,
    connectionUrl: `${origin}/connect#${connectCode}`,
    expiresAt,
    expiresInSeconds: CONNECT_CODE_LIFETIME_MS / 1_000,
  });
}

export async function pendingRequests(
  this: OwnedAgentService,
  member: MemberPrincipal,
) {
  const rows = ownedAgentRequestsListPending(
    this.storage,
    member.userId,
    new Date().toISOString(),
  );
  const username =
    rows.length > 0
      ? (await this.owners([member.userId])).get(member.userId)?.username
      : undefined;
  return ownedAgentRequestListSchema.parse({
    requests: rows.map((row) => ({
      id: row.request_id,
      name: row.name,
      provider: ownedAgentProviderSchema.parse(row.provider),
      // Without a username the card asks for one before it can approve.
      handle: ownedAgentHandle(username ?? "you", row.name),
      userCode: row.user_code,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })),
  });
}

/**
 * Accepts a request whose agent takes part through its person's own device,
 * where Chief's on-device runtime brings it into conversations. No owned
 * identity is created; the waiting agent is told it has joined.
 */
export function joinOnDevice(
  this: OwnedAgentService,
  member: MemberPrincipal,
  requestId: string | null,
) {
  const request = requestId
    ? ownedAgentRequestsFind(this.storage, requestId)
    : undefined;
  if (!request || request.user_id !== member.userId) {
    throw new HttpError(
      404,
      "agent_request_not_found",
      "That request was not found.",
    );
  }
  const now = new Date().toISOString();
  if (request.status !== "pending" || request.expires_at <= now) {
    throw new HttpError(
      409,
      "agent_request_closed",
      "That request has expired or was already answered.",
    );
  }
  ownedAgentRequestsUpdate(this.storage, request.request_id, {
    status: "joined_on_device",
    decided_at: now,
  });
  this.audit(
    member,
    "owned_agent.join_on_device",
    `Welcomed agent ${request.name} on their device.`,
    { ownerUserId: member.userId, provider: request.provider },
  );
  return ownedAgentDecisionResultSchema.parse({ status: "joined_on_device" });
}

export async function decide(
  this: OwnedAgentService,
  member: MemberPrincipal,
  requestId: string | null,
  approve: boolean,
) {
  const request = requestId
    ? ownedAgentRequestsFind(this.storage, requestId)
    : undefined;
  // Only the member the connect code was issued to may decide. Anyone else,
  // an admin included, learns nothing about the request.
  if (!request || request.user_id !== member.userId) {
    throw new HttpError(
      404,
      "agent_request_not_found",
      "That request was not found.",
    );
  }
  const now = new Date().toISOString();
  if (request.status !== "pending" || request.expires_at <= now) {
    throw new HttpError(
      409,
      "agent_request_closed",
      "That request has expired or was already answered.",
    );
  }
  if (!approve) {
    ownedAgentRequestsUpdate(this.storage, request.request_id, {
      status: "denied",
      decided_at: now,
    });
    this.audit(member, "owned_agent.deny", `Denied agent ${request.name}.`, {
      ownerUserId: member.userId,
      provider: request.provider,
    });
    return ownedAgentDecisionResultSchema.parse({ status: "denied" });
  }
  const owner = (await this.owners([member.userId])).get(member.userId);
  if (!owner?.username) {
    throw new HttpError(
      409,
      "username_required",
      "Choose a username before approving an agent.",
    );
  }
  const agentId = agentIdSchema.parse(
    `oa_${crypto.randomUUID().replaceAll("-", "")}`,
  );
  this.storage.transactionSync(() => {
    this.channels.requirePrincipalMember(member);
    const current = ownedAgentRequestsFind(this.storage, request.request_id);
    if (
      current?.status !== "pending" ||
      current.expires_at <= new Date().toISOString() ||
      current.user_id !== member.userId
    )
      throw new HttpError(
        409,
        "agent_request_closed",
        "That request has expired or was already answered.",
      );
    if (
      ownedAgentsFindActiveByOwnerName(
        this.storage,
        member.userId,
        request.name,
      )
    ) {
      throw new HttpError(
        409,
        "agent_name_taken",
        "You already have an agent with that name. Revoke it or ask this agent to pick another name.",
      );
    }
    if (ownedAgentsFindByPubkey(this.storage, request.pubkey)) {
      throw new HttpError(
        409,
        "agent_key_in_use",
        "That agent key was already used. Ask the agent to connect again.",
      );
    }
    if (
      ownedAgentsListActive(this.storage).filter(
        (agent) => agent.owner_user_id === member.userId,
      ).length >= maximumAgentsPerMember
    ) {
      throw new HttpError(
        409,
        "agent_limit_reached",
        "You have reached the limit of connected agents. Revoke one first.",
      );
    }
    ownedAgentsInsert(this.storage, {
      agent_id: agentId,
      owner_user_id: member.userId,
      name: request.name,
      provider: request.provider,
      pubkey: request.pubkey,
      status: "active",
      created_at: now,
    });
    const general = this.channels.requireChannelVisible("general", member);
    if (!this.channels.agentMayAccess(general, member.userId))
      throw new HttpError(
        403,
        "channel_unavailable",
        "You cannot grant access to General.",
      );
    ownedAgentChannelsInsert(this.storage, {
      agent_id: agentId,
      conversation_id: "general",
      added_by: member.userId,
      added_at: now,
    });
    ownedAgentRequestsUpdate(this.storage, request.request_id, {
      status: "approved",
      agent_id: agentId,
      decided_at: now,
    });
  });
  this.audit(
    member,
    "owned_agent.approve",
    `Approved agent ${request.name}.`,
    { ownerUserId: member.userId, provider: request.provider },
    agentId,
  );
  const agent = ownedAgentsFind(this.storage, agentId);
  return ownedAgentDecisionResultSchema.parse({
    status: "approved",
    agent: agent
      ? this.summary(agent, member, new Map([[member.userId, owner]]))
      : undefined,
  });
}

export async function list(this: OwnedAgentService, member: MemberPrincipal) {
  const agents = ownedAgentsListActive(this.storage);
  const owners = await this.owners(agents.map((agent) => agent.owner_user_id));
  return ownedAgentListSchema.parse({
    agents: agents.map((agent) => this.summary(agent, member, owners)),
  });
}

export function summary(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
  viewer: MemberPrincipal,
  owners: ReadonlyMap<string, { username: string | null; name: string | null }>,
) {
  const owner = owners.get(agent.owner_user_id);
  const displayName =
    owner?.name ??
    memberDisplayNames(this.storage).get(`user:${agent.owner_user_id}`) ??
    null;
  return {
    id: agent.agent_id,
    name: agent.name,
    provider: ownedAgentProviderSchema.parse(agent.provider),
    displayName: agent.display_name,
    avatar: storedAvatar(agent.avatar_json),
    handle: owner?.username
      ? ownedAgentHandle(owner.username, agent.name)
      : null,
    owner: {
      userId: agent.owner_user_id,
      username: owner?.username ?? null,
      name: displayName,
    },
    // A viewer only learns of channels they can see themselves.
    channels: this.accessibleChannels(agent)
      .filter((channel) => this.viewerSees(channel, viewer))
      .map((channel) => ({
        id: channel.conversation_id,
        name: channel.name,
      })),
    online: ownedAgentListenerCount(this.storage, agent.agent_id) > 0,
    createdAt: agent.created_at,
    lastSeenAt: agent.last_seen_at,
  };
}

export function viewerSees(
  this: OwnedAgentService,
  channel: ChannelRow,
  viewer: MemberPrincipal,
) {
  return (
    Number(channel.is_private) === 0 ||
    this.channels.channelMembership(
      channel.conversation_id,
      "user",
      viewer.userId,
    ) !== undefined
  );
}

export function requireManagedAgent(
  this: OwnedAgentService,
  member: MemberPrincipal,
  agentId: string | null,
) {
  const agent = agentId ? ownedAgentsFind(this.storage, agentId) : undefined;
  if (agent?.status !== "active") {
    throw new HttpError(
      404,
      "owned_agent_not_found",
      "That agent was not found.",
    );
  }
  const role = this.channels.memberRole("user", member.userId);
  if (
    agent.owner_user_id !== member.userId &&
    role !== "owner" &&
    role !== "admin"
  ) {
    throw new HttpError(
      403,
      "owned_agent_manage_denied",
      "Only the agent's owner or a workspace admin can do that.",
    );
  }
  return agent;
}

export async function update(
  this: OwnedAgentService,
  member: MemberPrincipal,
  agentId: string | null,
  { displayName }: OwnedAgentUpdate,
) {
  const agent = this.requireManagedAgent(member, agentId);
  ownedAgentsUpdate(this.storage, agent.agent_id, {
    display_name: displayName,
  });
  this.audit(
    member,
    "owned_agent.rename",
    `Renamed agent ${agent.name}.`,
    { ownerUserId: agent.owner_user_id },
    agent.agent_id,
  );
  const owners = await this.owners([agent.owner_user_id]);
  return this.summary({ ...agent, display_name: displayName }, member, owners);
}

/** The router has already checked the image is this agent's own upload. */
export function setAvatar(
  this: OwnedAgentService,
  member: MemberPrincipal,
  agentId: string | null,
  { avatar }: AgentAvatarSet,
) {
  const agent = this.requireManagedAgent(member, agentId);
  ownedAgentsUpdate(this.storage, agent.agent_id, {
    avatar_json: avatar ? JSON.stringify(avatar) : null,
  });
  return { agentId: agent.agent_id, avatar };
}

function storedAvatar(value: string | null) {
  if (!value) return null;
  try {
    return agentAvatarSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export function revoke(
  this: OwnedAgentService,
  member: MemberPrincipal,
  agentId: string | null,
) {
  const agent = this.requireManagedAgent(member, agentId);
  this.revokeAgent(agent, member.userId);
  this.audit(
    member,
    "owned_agent.revoke",
    `Revoked agent ${agent.name}.`,
    { ownerUserId: agent.owner_user_id },
    agent.agent_id,
  );
  return ownedAgentRevokedSchema.parse({ id: agent.agent_id, revoked: true });
}

export function revokeAgent(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
  revokedBy: string,
) {
  this.storage.transactionSync(() => {
    ownedAgentsUpdate(this.storage, agent.agent_id, {
      status: "revoked",
      revoked_at: new Date().toISOString(),
      revoked_by: revokedBy,
    });
    ownedAgentAccessDelete(this.storage, agent.agent_id);
    ownedAgentChallengesDeleteForAgent(this.storage, agent.agent_id);
  });
  closeOwnedAgentListeners(this.storage, agent.agent_id);
}

export async function addToChannel(
  this: OwnedAgentService,
  member: MemberPrincipal,
  agentId: string | null,
  rawConversationId: string | null,
) {
  const agent = this.requireManagedAgent(member, agentId);
  const conversationId = conversationIdSchema.parse(rawConversationId);
  const channel = this.channels.requireChannelVisible(conversationId, member);
  // The agent can go only where its owner can already go.
  if (!this.channels.agentMayAccess(channel, agent.owner_user_id)) {
    throw new HttpError(
      403,
      "owner_cannot_access_channel",
      "An agent can only join channels its owner can open.",
    );
  }
  const result = ownedAgentChannelResultSchema.parse({
    agentId: agent.agent_id,
    channelId: conversationId,
    member: true,
  });
  if (ownedAgentChannelsFind(this.storage, agent.agent_id, conversationId)) {
    return result;
  }
  const now = new Date().toISOString();
  ownedAgentChannelsInsert(this.storage, {
    agent_id: agent.agent_id,
    conversation_id: conversationId,
    added_by: member.userId,
    added_at: now,
  });
  this.audit(
    member,
    "owned_agent.channel_add",
    `Added agent ${agent.name} to a channel.`,
    { ownerUserId: agent.owner_user_id },
    agent.agent_id,
    conversationId,
  );
  const owner = (await this.owners([agent.owner_user_id])).get(
    agent.owner_user_id,
  );
  // The channel sees the same notice as when a person is added.
  await new WorkspaceChannelMembership(this.channels)
    .publishMemberAddedEvent(member.workspaceId, conversationId, {
      commandId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      actor: member,
      targets: [
        {
          kind: "agent",
          id: agent.agent_id,
          name: owner?.username
            ? ownedAgentHandle(owner.username, agent.name)
            : agent.name,
        },
      ],
      occurredAt: now,
    })
    .catch((error: unknown) => {
      console.error("relay.owned_agents.channel_notice_failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    });
  return result;
}

export function removeFromChannel(
  this: OwnedAgentService,
  member: MemberPrincipal,
  agentId: string | null,
  rawConversationId: string | null,
) {
  const conversationId = conversationIdSchema.parse(rawConversationId);
  const agent = agentId ? ownedAgentsFind(this.storage, agentId) : undefined;
  if (agent?.status !== "active") {
    throw new HttpError(
      404,
      "owned_agent_not_found",
      "That agent was not found.",
    );
  }
  const workspaceRole = this.channels.memberRole("user", member.userId);
  const channelRole = this.channels.channelMembership(
    conversationId,
    "user",
    member.userId,
  )?.role;
  if (
    agent.owner_user_id !== member.userId &&
    workspaceRole !== "owner" &&
    workspaceRole !== "admin" &&
    channelRole !== "owner" &&
    channelRole !== "admin"
  ) {
    throw new HttpError(
      403,
      "owned_agent_manage_denied",
      "Only the agent's owner or an admin can remove it from a channel.",
    );
  }
  ownedAgentChannelsDelete(this.storage, agent.agent_id, conversationId);
  this.audit(
    member,
    "owned_agent.channel_remove",
    `Removed agent ${agent.name} from a channel.`,
    { ownerUserId: agent.owner_user_id },
    agent.agent_id,
    conversationId,
  );
  return ownedAgentChannelResultSchema.parse({
    agentId: agent.agent_id,
    channelId: conversationId,
    member: false,
  });
}
