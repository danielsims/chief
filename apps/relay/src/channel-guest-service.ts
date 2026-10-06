import type { ChannelGuestJoinInput, Principal } from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  channelGuestInviteSchema,
  channelGuestJoinInputSchema,
  channelGuestJoinResultSchema,
  channelGuestListSchema,
  channelMemberJoinedPayloadSchema,
  conversationIdSchema,
  guestIdSchema,
  guestNameSchema,
} from "@chief/relay-contracts";

import type { ChannelGuestRow } from "./queries/channel-guests/guests";
import type { ChannelRow } from "./workspace-channel-store";
import { storeGuestAvatar } from "./channel-guest-avatar";
import {
  newGuestId,
  newGuestToken,
  randomBase64Url,
  sha256Hex,
} from "./channel-guest-crypto";
import {
  guestHttpTools,
  guestInstructions,
  guestNextStep,
} from "./channel-guest-manual";
import {
  grokBotMark,
  preferredGuestHandle,
  uniqueGuestHandle,
} from "./channel-guest-profile";
import { ChannelGuestSession } from "./channel-guest-session";
import {
  ChannelGuestBase,
  GUEST_GATEWAY_SERVICE,
  linkDenied,
  PUBLIC_ORIGIN_HEADER,
} from "./channel-guest-shared";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext, withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import {
  channelGuestsCountJoinedSince,
  channelGuestsFind,
  channelGuestsInsert,
  channelGuestsListForConversation,
} from "./queries/channel-guests/guests";
import {
  channelGuestInvitesDelete,
  channelGuestInvitesDeleteExpired,
  channelGuestInvitesFind,
  channelGuestInvitesInsert,
} from "./queries/channel-guests/invites";
import { workspaceAgentNames } from "./workspace-agent-runtime";
import { memberDisplayNames } from "./workspace-member-names";

const maximumGuestsPerChannel = 25;
const joinWindowMs = 60 * 60 * 1_000;
const maximumJoinsPerWindow = 10;
const inviteLifetimeMs = 24 * 60 * 60 * 1_000;

function inviteInvalid() {
  return new HttpError(
    404,
    "agent_invite_invalid",
    "This invite has expired or was already used. Ask the person you work for to send a new one.",
  );
}

/** Invite tokens are 32 URL-safe characters. */
export function isInviteToken(value: string) {
  return /^[A-Za-z0-9_-]{32}$/u.test(value);
}

/** The name the agent asked for, or the one in its Grok Bot profile. */
function joinName(input: ChannelGuestJoinInput) {
  const parsed = guestNameSchema.safeParse(
    input.name ?? input.grokProfile?.name,
  );
  if (!parsed.success) {
    throw new HttpError(
      400,
      "guest_name_invalid",
      "Send a `name` (or a `grokProfile` with one) of letters, numbers, spaces, dots, apostrophes, underscores or hyphens.",
    );
  }
  return parsed.data;
}
/**
 * Agents that members invite into channels.
 *
 * There is no public way in. A member who can see a channel creates a
 * single-use invite for their own agent; the agent that joins with it works
 * for that member, is shown that way, and can only ever reach that one
 * channel, and only while its member still can. It can read and post there
 * and nothing else: no other channels, files, members' ids, secrets or tools.
 * Agent messages never wake workspace agents.
 */
export class ChannelGuestService extends ChannelGuestBase {
  async route(request: Request, operation: string) {
    const context = readTrustedContext(request);
    const origin = request.headers.get(PUBLIC_ORIGIN_HEADER) ?? "";
    const url = new URL(request.url);
    switch (operation) {
      case "guest-list":
        return json(this.guestList(context.principal, url));
      case "guest-remove":
        return json(this.guestRemove(context.principal, url));
      case "guest-invite-create":
        return json(await this.inviteCreate(context.principal, url, origin));
    }
    this.requireGateway(context.principal);
    switch (operation) {
      case "guest-invite-resolve":
        return json(
          await this.inviteResolve(url.searchParams.get("token") ?? ""),
        );
      case "guest-join":
        return json(
          await this.join(
            url.searchParams.get("token") ?? "",
            channelGuestJoinInputSchema.parse(await parseJson(request)),
            origin,
          ),
          { status: 201 },
        );
    }
    return new ChannelGuestSession(this.storage, this.env).route(
      request,
      operation,
      origin,
    );
  }

  // Joining ---------------------------------------------------------------

  private async join(
    inviteToken: string,
    input: ChannelGuestJoinInput,
    origin: string,
  ) {
    const { channel, tokenHash } = await this.requireInvite(inviteToken);
    const conversationId = channel.conversation_id;
    const name = joinName(input);
    const mark = input.grokProfile ? grokBotMark(input.grokProfile) : undefined;
    const provider = input.provider ?? (input.grokProfile ? "grok" : undefined);

    const now = new Date();
    const recentJoins = channelGuestsCountJoinedSince(
      this.storage,
      conversationId,
      new Date(now.getTime() - joinWindowMs).toISOString(),
    );
    if (recentJoins >= maximumJoinsPerWindow) {
      throw new HttpError(
        429,
        "guest_joins_limited",
        "Too many agents joined this channel recently. Try again later.",
      );
    }
    const active = channelGuestsListForConversation(
      this.storage,
      conversationId,
      ["active"],
    );
    if (active.length >= maximumGuestsPerChannel) {
      throw new HttpError(
        409,
        "guest_limit_reached",
        "This channel already has the maximum number of guest agents.",
      );
    }
    this.requireAvailableName(name);
    const credential = newGuestToken();
    const guestId = newGuestId();
    const image = input.avatarUrl
      ? await storeGuestAvatar(this.env, origin, guestId, input.avatarUrl)
      : null;
    const webhook = input.webhook
      ? await this.sealedWebhook(input.webhook)
      : undefined;
    const row: ChannelGuestRow = {
      guest_id: guestId,
      conversation_id: conversationId,
      name,
      about: input.about ?? null,
      avatar_url: image,
      provider: provider ?? "other",
      model: input.model ?? null,
      handle: null,
      mark_shape: mark?.shape ?? null,
      mark_color: mark?.color ?? null,
      operator_user_id: null,
      token_hash: await sha256Hex(credential),
      status: "active",
      wake: input.wake,
      webhook_url: null,
      webhook_authorization: null,
      webhook_secret: null,
      created_at: now.toISOString(),
      removed_at: null,
      last_seen_at: null,
      post_window_started_at: null,
      post_window_count: 0,
      ...webhook?.columns,
    };
    // Nothing awaits between taking the invite and inserting the agent, so a
    // single-use invite admits exactly one.
    this.storage.transactionSync(() => {
      row.operator_user_id = this.takeInvite(tokenHash);
      row.handle = this.assignHandle(row);
      channelGuestsInsert(this.storage, row);
    });
    await this.announce(row);
    return this.joinResult(
      channel,
      row,
      credential,
      origin,
      webhook?.signingSecret,
    );
  }

  /** The join response carries the whole manual, so an agent that joins
   * cannot miss how to take part. */
  private joinResult(
    channel: ChannelRow,
    guest: ChannelGuestRow,
    credential: string,
    origin: string,
    webhookSigningSecret?: string,
  ) {
    const api = this.apiUrls(origin, credential);
    return channelGuestJoinResultSchema.parse({
      instructions: guestInstructions(`#${channel.name}`),
      guest: this.summary(guest),
      token: credential,
      webhookSigningSecret,
      api,
      tools: guestHttpTools(api.base),
      next: guestNextStep,
    });
  }

  /** A handle no other guest in the channel has. */
  private assignHandle(guest: ChannelGuestRow) {
    return uniqueGuestHandle(
      this.storage,
      channelGuestsListForConversation(this.storage, guest.conversation_id, [
        "active",
      ]).filter((other) => other.guest_id !== guest.guest_id),
      preferredGuestHandle(this.storage, guest),
    );
  }

  // Invites ---------------------------------------------------------------

  /** A member's single-use link for their own agent. The agent that joins
   * with it works for that member, because the member made it. */
  private async inviteCreate(principal: Principal, url: URL, origin: string) {
    if (principal.kind !== "user") throw linkDenied();
    this.channels.requirePrincipalMember(principal);
    const channel = this.channels.requireChannelVisible(
      this.conversationParam(url),
      principal,
    );
    if (!this.channels.agentMayAccess(channel, principal.userId)) {
      throw new HttpError(
        409,
        "channel_not_open_to_agents",
        "Agents can only be invited into active channels.",
      );
    }
    const token = randomBase64Url(24);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + inviteLifetimeMs).toISOString();
    channelGuestInvitesDeleteExpired(this.storage, now.toISOString());
    channelGuestInvitesInsert(this.storage, {
      token_hash: await sha256Hex(token),
      conversation_id: channel.conversation_id,
      operator_user_id: principal.userId,
      created_at: now.toISOString(),
      expires_at: expiresAt,
    });
    return channelGuestInviteSchema.parse({
      url: `${origin}/agents/${encodeURIComponent(this.workspace().id)}/${token}`,
      expiresAt,
    });
  }

  /** What the invite page shows: the channel and who sent it. */
  private async inviteResolve(token: string) {
    const { channel, invite } = await this.requireInvite(token);
    return {
      workspace: { id: this.workspace().id, name: this.workspace().name },
      channel: {
        id: channel.conversation_id,
        name: channel.name,
        description: channel.description,
      },
      invitedBy:
        memberDisplayNames(this.storage).get(
          `user:${invite.operator_user_id}`,
        ) ?? "A workspace member",
    };
  }

  /** A live invite to a channel its member can still reach. */
  private async requireInvite(token: string) {
    if (!isInviteToken(token)) throw inviteInvalid();
    const tokenHash = await sha256Hex(token);
    const invite = channelGuestInvitesFind(this.storage, tokenHash);
    if (!invite || Date.parse(invite.expires_at) <= Date.now()) {
      throw inviteInvalid();
    }
    const channel = this.channels.requireChannel(invite.conversation_id);
    if (!this.channels.agentMayAccess(channel, invite.operator_user_id)) {
      throw inviteInvalid();
    }
    return { channel, invite, tokenHash };
  }

  /** Uses up the invite and returns the member it belongs to. */
  private takeInvite(tokenHash: string) {
    const invite = channelGuestInvitesFind(this.storage, tokenHash);
    if (!invite || Date.parse(invite.expires_at) <= Date.now()) {
      throw inviteInvalid();
    }
    channelGuestInvitesDelete(this.storage, tokenHash);
    return invite.operator_user_id;
  }

  /** An agent cannot borrow the name of a person or a workspace agent, so it
   * can never pass as one of them. Agents may share names with each other:
   * their handles tell them apart. */
  private requireAvailableName(name: string) {
    const wanted = name.trim().toLocaleLowerCase();
    const matches = (existing: string) =>
      existing.trim().toLocaleLowerCase() === wanted;
    if (
      [
        ...memberDisplayNames(this.storage).values(),
        ...workspaceAgentNames(this.storage).values(),
        "chief",
      ].some(matches)
    ) {
      throw new HttpError(
        409,
        "guest_name_taken",
        "That name belongs to someone in this workspace. Choose another.",
      );
    }
  }

  // Members ---------------------------------------------------------------

  private guestList(principal: Principal, url: URL) {
    this.channels.requirePrincipalMember(principal);
    const conversationId = this.conversationParam(url);
    this.channels.requireChannelVisible(conversationId, principal);
    return channelGuestListSchema.parse({
      guests: channelGuestsListForConversation(this.storage, conversationId, [
        "active",
      ]).map((guest) => this.summary(guest)),
    });
  }

  private guestRemove(principal: Principal, url: URL) {
    this.channels.requirePrincipalMember(principal);
    const guest = channelGuestsFind(
      this.storage,
      guestIdSchema.parse(url.searchParams.get("guestId")),
    );
    if (!guest || guest.conversation_id !== this.conversationParam(url)) {
      throw new HttpError(404, "guest_not_found", "This guest was not found.");
    }
    // Any member who can see the channel can show an agent out of it.
    this.channels.requireChannelVisible(guest.conversation_id, principal);
    this.remove(guest);
    return { removed: true };
  }

  /** Authored by the guest itself with fixed text, so agents read it fenced
   * like any guest message and no chosen name ever appears as Chief's. */
  private async announce(guest: ChannelGuestRow) {
    const context = this.guestContext(guest);
    const { workspaceId } = context;
    const conversationId = guest.conversation_id;
    const commandId = crypto.randomUUID();
    const body = "Joined the channel.";
    const response = await this.env.CONVERSATIONS.get(
      this.env.CONVERSATIONS.idFromName(`${workspaceId}:${conversationId}`),
    ).fetch(
      withTrustedContext(
        new Request(
          `https://relay.internal/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              appendMessageCommandSchema.parse({
                commandId,
                protocolVersion: 1,
                occurredAt: new Date().toISOString(),
                payload: {
                  messageId: commandId,
                  conversationId,
                  body,
                  mentions: [],
                  // Renders as a membership line, like a member being added.
                  components: [
                    {
                      id: `${commandId}:joined`,
                      kind: "channel-action",
                      version: 1,
                      payload: channelMemberJoinedPayloadSchema.parse({
                        type: "member-joined",
                        actorName: guest.name,
                      }),
                    },
                  ],
                },
              }),
            ),
          },
        ),
        context,
      ),
    );
    await releaseInternalResponse(response);
  }

  private requireGateway(principal: Principal) {
    if (
      principal.kind !== "service" ||
      principal.service !== GUEST_GATEWAY_SERVICE
    ) {
      throw new HttpError(403, "forbidden", "Guest gateway access only.");
    }
  }

  private conversationParam(url: URL) {
    return conversationIdSchema.parse(url.searchParams.get("conversationId"));
  }
}
