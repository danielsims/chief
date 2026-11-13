import type { AgentPrincipal, WorkspaceId } from "@chief/relay-contracts";
import {
  agentIdSchema,
  hexPubkeySchema,
  ownedAgentChallengeSchema,
  ownedAgentConnectCommandSchema,
  ownedAgentConnectResultSchema,
  ownedAgentCredentialCommandSchema,
  ownedAgentCredentialSchema,
  ownedAgentHandle,
  ownedAgentRevokedSchema,
  ownedAgentSelfSchema,
  ownedAgentTokenCommandSchema,
  ownedAgentTokenResultSchema,
} from "@chief/relay-contracts";

import type { OwnedAgentService } from "./owned-agent-service";
import type { OwnedAgentRow } from "./queries/owned-agents/agents";
import type { ChannelRow } from "./workspace-channel-store";
import { randomToken, sha256 } from "./external-agent-channel-security";
import { HttpError, json, parseJson } from "./http";
import { issueOwnedAgentCredential } from "./owned-agent-credential";
import {
  challengeLifetimeMs,
  channelSummary,
  DEVICE_CODE_LIFETIME_SECONDS,
  DEVICE_CODE_POLL_INTERVAL_SECONDS,
  maximumPendingRequestsPerMember,
  maximumRequestsPerCode,
  OWNED_AGENT_ID_HEADER,
  OWNED_AGENT_PUBKEY_HEADER,
  pollToleranceMs,
  randomUserCode,
  tokenError,
} from "./owned-agent-shared";
import {
  ownedAgentChannelsFind,
  ownedAgentChannelsListForAgent,
  ownedAgentsFind,
  ownedAgentsFindActiveByOwnerName,
  ownedAgentsFindByPubkey,
  ownedAgentsUpdate,
} from "./queries/owned-agents/agents";
import {
  ownedAgentChallengesConsume,
  ownedAgentChallengesInsert,
  ownedAgentConnectCodesCountRequest,
  ownedAgentConnectCodesFind,
  ownedAgentRequestsFindByDeviceCodeHash,
  ownedAgentRequestsFindOpenConflict,
  ownedAgentRequestsInsert,
  ownedAgentRequestsListPending,
  ownedAgentRequestsUpdate,
} from "./queries/owned-agents/connect";

export async function routeAgent(
  this: OwnedAgentService,
  request: Request,
  operation: string,
  workspaceId: WorkspaceId,
  origin: string,
) {
  const pubkey = hexPubkeySchema.parse(
    request.headers.get(OWNED_AGENT_PUBKEY_HEADER),
  );
  if (operation === "owned-agent-connect") {
    return json(await this.connect(request, pubkey), { status: 201 });
  }
  if (operation === "owned-agent-token") {
    return json(await this.token(request, pubkey, workspaceId));
  }
  const agent = this.requireActiveAgent(
    request.headers.get(OWNED_AGENT_ID_HEADER),
    pubkey,
  );
  const url = new URL(request.url);
  switch (operation) {
    case "owned-agent-challenge":
      return json(await this.challenge(agent), { status: 201 });
    case "owned-agent-credential":
      return json(await this.credential(request, agent, workspaceId), {
        status: 201,
      });
    case "owned-agent-self":
      return json(await this.describeSelf(agent, workspaceId));
    case "owned-agent-messages":
      return json(
        this.readMessages(agent, {
          after: url.searchParams.get("after"),
          limit: url.searchParams.get("limit"),
          channel: url.searchParams.get("channel"),
        }),
      );
    case "owned-agent-post":
      return json(await this.post(request, agent, workspaceId), {
        status: 201,
      });
    case "owned-agent-socket-ticket":
      return json(await this.socketTicket(agent, workspaceId, origin), {
        status: 201,
      });
    case "owned-agent-leave":
      this.revokeAgent(agent, agent.agent_id);
      this.auditAgent(
        workspaceId,
        "owned_agent.revoke",
        `Agent ${agent.name} left.`,
        agent,
      );
      return json(
        ownedAgentRevokedSchema.parse({ id: agent.agent_id, revoked: true }),
      );
  }
  throw new HttpError(404, "not_found", "Owned agent operation not found.");
}

export async function connect(
  this: OwnedAgentService,
  request: Request,
  pubkey: string,
) {
  const input = ownedAgentConnectCommandSchema.parse(await parseJson(request));
  // The request is signed with the key it registers, so a caller cannot
  // enroll a key it does not hold.
  if (input.publicKey !== pubkey) {
    throw new HttpError(
      401,
      "agent_key_mismatch",
      "Sign the request with the key being registered.",
    );
  }
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const codeHash = await sha256(input.code);
  const code = ownedAgentConnectCodesFind(this.storage, codeHash);
  if (
    code?.invalidated_at !== null ||
    code.expires_at <= nowIso ||
    this.channels.memberRole("user", code.user_id) === null
  ) {
    throw new HttpError(
      404,
      "connect_code_invalid",
      "That connect code is invalid or has expired. Ask for a new setup prompt.",
    );
  }
  if (
    code.request_count >= maximumRequestsPerCode ||
    ownedAgentRequestsListPending(this.storage, code.user_id, nowIso).length >=
      maximumPendingRequestsPerMember
  ) {
    throw new HttpError(
      429,
      "connect_code_exhausted",
      "Too many requests were made with this connect code. Ask for a new setup prompt.",
    );
  }
  ownedAgentConnectCodesCountRequest(this.storage, codeHash);
  if (ownedAgentsFindByPubkey(this.storage, pubkey)) {
    throw new HttpError(
      409,
      "agent_key_in_use",
      "This key already belongs to an agent. Remove its binding and connect again.",
    );
  }
  if (
    ownedAgentsFindActiveByOwnerName(this.storage, code.user_id, input.name)
  ) {
    throw new HttpError(
      409,
      "agent_name_taken",
      "That name is already used by one of this person's agents. Choose another name.",
    );
  }
  if (
    ownedAgentRequestsFindOpenConflict(this.storage, {
      userId: code.user_id,
      name: input.name,
      pubkey,
      now: nowIso,
    })
  ) {
    throw new HttpError(
      409,
      "agent_request_pending",
      "A request with this name or key is already waiting for approval.",
    );
  }
  const deviceCode = randomToken();
  const userCode = randomUserCode();
  ownedAgentRequestsInsert(this.storage, {
    request_id: crypto.randomUUID(),
    code_hash: codeHash,
    user_id: code.user_id,
    name: input.name,
    provider: input.provider,
    pubkey,
    device_code_hash: await sha256(deviceCode),
    user_code: userCode,
    status: "pending",
    poll_interval: DEVICE_CODE_POLL_INTERVAL_SECONDS,
    created_at: nowIso,
    expires_at: new Date(
      now + DEVICE_CODE_LIFETIME_SECONDS * 1_000,
    ).toISOString(),
  });
  return ownedAgentConnectResultSchema.parse({
    device_code: deviceCode,
    user_code: userCode,
    expires_in: DEVICE_CODE_LIFETIME_SECONDS,
    interval: DEVICE_CODE_POLL_INTERVAL_SECONDS,
  });
}

export async function token(
  this: OwnedAgentService,
  request: Request,
  pubkey: string,
  workspaceId: WorkspaceId,
) {
  const input = ownedAgentTokenCommandSchema.parse(await parseJson(request));
  const row = ownedAgentRequestsFindByDeviceCodeHash(
    this.storage,
    await sha256(input.device_code),
  );
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  // A device code alone is worthless: the poll must be signed by the key
  // that made the request. A wrong key looks the same as an unknown code.
  if (!row || row.pubkey !== pubkey || row.expires_at <= nowIso) {
    throw tokenError("expired_token", "This request has expired.");
  }
  const lastPolled = row.last_polled_at ? Date.parse(row.last_polled_at) : 0;
  if (
    row.status === "pending" &&
    now - lastPolled < row.poll_interval * 1_000 - pollToleranceMs
  ) {
    const interval = Math.min(row.poll_interval + 5, 60);
    ownedAgentRequestsUpdate(this.storage, row.request_id, {
      poll_interval: interval,
      last_polled_at: nowIso,
    });
    throw tokenError("slow_down", "Polling too quickly.", interval);
  }
  ownedAgentRequestsUpdate(this.storage, row.request_id, {
    last_polled_at: nowIso,
  });
  if (row.status === "pending") {
    throw tokenError(
      "authorization_pending",
      "Waiting for approval in Chief.",
      row.poll_interval,
    );
  }
  if (row.status === "denied") {
    throw tokenError("access_denied", "The request was denied.");
  }
  const agent =
    row.status === "approved" && row.agent_id
      ? ownedAgentsFind(this.storage, row.agent_id)
      : undefined;
  if (agent?.status !== "active" || agent.pubkey !== pubkey) {
    throw tokenError("expired_token", "This request has expired.");
  }
  const owner = (await this.owners([agent.owner_user_id])).get(
    agent.owner_user_id,
  );
  // The response holds no secret. Credentials always come from signing a
  // fresh challenge with the agent key.
  return ownedAgentTokenResultSchema.parse({
    agentId: agent.agent_id,
    workspaceId,
    name: agent.name,
    handle: ownedAgentHandle(owner?.username ?? "unknown", agent.name),
    ownerUserId: agent.owner_user_id,
  });
}

export function requireActiveAgent(
  this: OwnedAgentService,
  agentId: string | null,
  pubkey: string,
) {
  const agent = agentId ? ownedAgentsFind(this.storage, agentId) : undefined;
  if (
    agent?.status !== "active" ||
    agent.pubkey !== pubkey ||
    this.channels.memberRole("user", agent.owner_user_id) === null
  ) {
    throw new HttpError(
      401,
      "agent_revoked",
      "This agent is not connected to the workspace. It may have been revoked.",
    );
  }
  const seen = agent.last_seen_at ? Date.parse(agent.last_seen_at) : 0;
  if (Date.now() - seen > 60_000) {
    ownedAgentsUpdate(this.storage, agent.agent_id, {
      last_seen_at: new Date().toISOString(),
    });
  }
  return agent;
}

export function listenerMayConnect(
  this: OwnedAgentService,
  principal: AgentPrincipal,
) {
  const agent = ownedAgentsFind(this.storage, principal.agentId);
  return (
    agent?.status === "active" &&
    agent.pubkey === principal.pubkey &&
    this.channels.memberRole("user", agent.owner_user_id) !== null
  );
}

export async function challenge(this: OwnedAgentService, agent: OwnedAgentRow) {
  const challenge = randomToken();
  const expiresAt = new Date(Date.now() + challengeLifetimeMs).toISOString();
  ownedAgentChallengesInsert(this.storage, {
    challenge_hash: await sha256(challenge),
    agent_id: agent.agent_id,
    expires_at: expiresAt,
  });
  return ownedAgentChallengeSchema.parse({ challenge, expiresAt });
}

export async function credential(
  this: OwnedAgentService,
  request: Request,
  agent: OwnedAgentRow,
  workspaceId: WorkspaceId,
) {
  const input = ownedAgentCredentialCommandSchema.parse(
    await parseJson(request),
  );
  const challenge = ownedAgentChallengesConsume(
    this.storage,
    await sha256(input.challenge),
  );
  if (
    !challenge ||
    challenge.agent_id !== agent.agent_id ||
    challenge.expires_at <= new Date().toISOString()
  ) {
    throw new HttpError(
      401,
      "agent_challenge_invalid",
      "That challenge is invalid or has expired. Request a new one.",
    );
  }
  return ownedAgentCredentialSchema.parse(
    await issueOwnedAgentCredential(this.env, {
      agentId: agentIdSchema.parse(agent.agent_id),
      pubkey: hexPubkeySchema.parse(agent.pubkey),
      workspaceId,
    }),
  );
}

export async function describeSelf(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
  workspaceId: WorkspaceId,
) {
  const owner = (await this.owners([agent.owner_user_id])).get(
    agent.owner_user_id,
  );
  return ownedAgentSelfSchema.parse({
    agentId: agent.agent_id,
    workspaceId,
    name: agent.name,
    handle: owner?.username
      ? ownedAgentHandle(owner.username, agent.name)
      : null,
    channels: this.accessibleChannels(agent).map(channelSummary),
  });
}

export function accessibleChannels(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
) {
  const channels: ChannelRow[] = [];
  for (const row of ownedAgentChannelsListForAgent(
    this.storage,
    agent.agent_id,
  )) {
    let channel: ChannelRow;
    try {
      channel = this.channels.requireChannel(row.conversation_id);
    } catch {
      continue;
    }
    if (this.channels.agentMayAccess(channel, agent.owner_user_id)) {
      channels.push(channel);
    }
  }
  return channels;
}

export function requireAgentChannel(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
  conversationId: string,
) {
  const channel = ownedAgentChannelsFind(
    this.storage,
    agent.agent_id,
    conversationId,
  )
    ? this.accessibleChannels(agent).find(
        (candidate) => candidate.conversation_id === conversationId,
      )
    : undefined;
  if (!channel) {
    throw new HttpError(
      403,
      "channel_unavailable",
      "This agent is not in that channel.",
    );
  }
  return channel;
}
