import type { ChannelGuestJoinInput, Principal } from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  channelExternalAccessSchema,
  channelExternalUpdateSchema,
  channelGuestJoinInputSchema,
  channelGuestJoinResultSchema,
  channelGuestListSchema,
  channelMemberJoinedPayloadSchema,
  conversationIdSchema,
  guestIdSchema,
} from "@chief/relay-contracts";

import type { ChannelGuestRow } from "./queries/channel-guests/guests";
import type { ChannelRow } from "./workspace-channel-store";
import { storeGuestAvatar } from "./channel-guest-avatar";
import {
  GUEST_CREDENTIAL_HEADER,
  guestTokenFrom,
  newGuestId,
  newGuestToken,
  randomBase64Url,
  sha256Hex,
} from "./channel-guest-crypto";
import { closeExternalChannel } from "./channel-guest-lifecycle";
import { ChannelGuestSession } from "./channel-guest-session";
import {
  ChannelGuestBase,
  GUEST_GATEWAY_SERVICE,
  isExternalChannel,
  linkDenied,
  linkNotFound,
  PUBLIC_ORIGIN_HEADER,
} from "./channel-guest-shared";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext, withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import {
  channelGuestsCountJoinedSince,
  channelGuestsFind,
  channelGuestsFindByTokenHash,
  channelGuestsInsert,
  channelGuestsListForConversation,
  channelGuestsUpdate,
} from "./queries/channel-guests/guests";
import { channelsFindExternalChannel } from "./queries/channels/find-external-channel";
import { channelsUpdateChannelsExternal } from "./queries/channels/update-channels-external";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import { workspaceAgentNames } from "./workspace-agent-runtime";
import { firstRow } from "./workspace-channel-rows";
import { memberDisplayNames } from "./workspace-member-names";

const maximumGuestsPerChannel = 25;
const joinWindowMs = 60 * 60 * 1_000;
const maximumJoinsPerWindow = 10;
/**
 * External channels and the outside agents admitted through their links.
 *
 * Only a channel a workspace owner or admin explicitly made external has a
 * link. A guest is bound to exactly one external channel. It can read and
 * post there and nothing else: no other channels, files, members' ids,
 * secrets or tools. Anyone holding the link can join instantly, so joins are
 * capped, any member can remove a guest, and guest messages never wake
 * workspace agents.
 */
export class ChannelGuestService extends ChannelGuestBase {
  async route(request: Request, operation: string) {
    const context = readTrustedContext(request);
    const origin = request.headers.get(PUBLIC_ORIGIN_HEADER) ?? "";
    const url = new URL(request.url);
    switch (operation) {
      case "channel-external-get":
        return json(this.externalGet(context.principal, url, origin));
      case "channel-external-set":
        return json(
          this.externalSet(
            context.principal,
            url,
            origin,
            channelExternalUpdateSchema.parse(await parseJson(request))
              .external,
          ),
        );
      case "channel-external-reset":
        return json(this.externalReset(context.principal, url, origin));
      case "guest-list":
        return json(this.guestList(context.principal, url));
      case "guest-remove":
        return json(this.guestRemove(context.principal, url));
    }
    this.requireGateway(context.principal);
    switch (operation) {
      case "guest-link-resolve":
        return json(this.linkResolve(url.searchParams.get("token") ?? ""));
      case "guest-join":
        return json(
          await this.join(
            url.searchParams.get("token") ?? "",
            channelGuestJoinInputSchema.parse(await parseJson(request)),
            origin,
            guestTokenFrom(request.headers.get(GUEST_CREDENTIAL_HEADER)),
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

  // External access -----------------------------------------------------

  private externalGet(principal: Principal, url: URL, origin: string) {
    if (principal.kind !== "user") throw linkDenied();
    this.channels.requirePrincipalMember(principal);
    const channel = this.channels.requireChannelVisible(
      this.conversationParam(url),
      principal,
    );
    return this.describeExternal(channel, origin);
  }

  /** Only workspace owners and admins decide who outside can get in. */
  private externalSet(
    principal: Principal,
    url: URL,
    origin: string,
    external: boolean,
  ) {
    const channel = this.requireAdministeredChannel(principal, url);
    if (!external) {
      this.storage.transactionSync(() =>
        closeExternalChannel(this.storage, channel.conversation_id),
      );
    } else if (channel.external_link_token === null) {
      if (
        channel.kind !== "channel" ||
        Number(channel.is_private) === 1 ||
        Number(channel.archived) === 1
      ) {
        throw new HttpError(
          409,
          "channel_not_externalizable",
          "Only active channels that aren't private can be made external.",
        );
      }
      this.setLinkToken(channel.conversation_id, randomBase64Url(18));
    }
    return this.externalGet(principal, url, origin);
  }

  /** Replaces the link. The old one stops working; guests stay. */
  private externalReset(principal: Principal, url: URL, origin: string) {
    const channel = this.requireAdministeredChannel(principal, url);
    if (!isExternalChannel(channel)) {
      throw new HttpError(
        409,
        "channel_not_external",
        "Only external channels have a link.",
      );
    }
    this.setLinkToken(channel.conversation_id, randomBase64Url(18));
    return this.externalGet(principal, url, origin);
  }

  private requireAdministeredChannel(principal: Principal, url: URL) {
    if (principal.kind !== "user") throw linkDenied();
    requireWorkspaceAdministrator(this.channels, principal);
    return this.channels.requireChannelVisible(
      this.conversationParam(url),
      principal,
    );
  }

  private setLinkToken(conversationId: string, token: string) {
    channelsUpdateChannelsExternal(this.storage, {
      externalLinkToken: token,
      updatedAt: new Date().toISOString(),
      conversationId,
    });
  }

  private describeExternal(channel: ChannelRow, origin: string) {
    return channelExternalAccessSchema.parse(
      isExternalChannel(channel) && channel.external_link_token !== null
        ? {
            external: true,
            url: `${origin}/c/${encodeURIComponent(this.workspace().id)}/${channel.external_link_token}`,
          }
        : { external: false },
    );
  }

  private linkResolve(token: string) {
    const { channel } = this.requireOpenLink(token);
    const workspace = this.workspace();
    return {
      workspace: { id: workspace.id, name: workspace.name },
      channel: {
        id: channel.conversation_id,
        name: channel.name,
        description: channel.description,
      },
      members: this.channels.channelMemberRows(channel.conversation_id).length,
    };
  }

  private requireOpenLink(token: string) {
    const channel = /^[A-Za-z0-9_-]{24}$/u.test(token)
      ? firstRow<ChannelRow>(channelsFindExternalChannel(this.storage, token))
      : undefined;
    if (!channel || !isExternalChannel(channel)) throw linkNotFound();
    return { channel };
  }

  // Joining ---------------------------------------------------------------

  private async join(
    token: string,
    input: ChannelGuestJoinInput,
    origin: string,
    existingCredential: string | null,
  ) {
    const { channel } = this.requireOpenLink(token);
    // Joining again with a saved token is harmless: it returns the same
    // identity, so an agent that repeats the join never splits into two.
    const existing = existingCredential
      ? channelGuestsFindByTokenHash(
          this.storage,
          await sha256Hex(existingCredential),
        )
      : undefined;
    if (
      existingCredential &&
      existing?.status === "active" &&
      existing.conversation_id === channel.conversation_id
    ) {
      if (input.avatarUrl) {
        const avatar = await storeGuestAvatar(
          this.env,
          origin,
          existing.guest_id,
          input.avatarUrl,
        );
        if (avatar) {
          channelGuestsUpdate(this.storage, existing.guest_id, {
            avatar_url: avatar,
          });
          existing.avatar_url = avatar;
        }
      }
      return channelGuestJoinResultSchema.parse({
        guest: this.summary(existing),
        token: existingCredential,
        api: this.apiUrls(origin, existingCredential),
      });
    }
    const now = new Date();
    const recentJoins = channelGuestsCountJoinedSince(
      this.storage,
      channel.conversation_id,
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
      channel.conversation_id,
      ["active"],
    );
    if (active.length >= maximumGuestsPerChannel) {
      throw new HttpError(
        409,
        "guest_limit_reached",
        "This channel already has the maximum number of guest agents.",
      );
    }
    this.requireAvailableName(channel.conversation_id, input.name);
    const credential = newGuestToken();
    const guestId = newGuestId();
    const row: ChannelGuestRow = {
      guest_id: guestId,
      conversation_id: channel.conversation_id,
      name: input.name,
      about: input.about ?? null,
      avatar_url: input.avatarUrl
        ? await storeGuestAvatar(this.env, origin, guestId, input.avatarUrl)
        : null,
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
    };
    const webhook = input.webhook
      ? await this.sealedWebhook(input.webhook)
      : undefined;
    if (webhook) Object.assign(row, webhook.columns);
    channelGuestsInsert(this.storage, row);
    await this.announce(row);
    return channelGuestJoinResultSchema.parse({
      guest: this.summary(row),
      token: credential,
      webhookSigningSecret: webhook?.signingSecret,
      api: this.apiUrls(origin, credential),
    });
  }

  /** A guest cannot borrow the name of a person, a workspace agent or another
   * guest in the channel, so it can never pass as one of them. */
  private requireAvailableName(conversationId: string, name: string) {
    const wanted = name.trim().toLocaleLowerCase();
    const matches = (existing: string) =>
      existing.trim().toLocaleLowerCase() === wanted;
    if (
      channelGuestsListForConversation(this.storage, conversationId, [
        "active",
      ]).some((guest) => matches(guest.name))
    ) {
      throw new HttpError(
        409,
        "guest_already_joined",
        "A guest with this name is already in the channel. If that is you, you have already joined: keep using the token from that join. Calling join again with it as `Authorization: Bearer <token>` returns the same identity. Do not join under a new name.",
      );
    }
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
    // Any member can show a guest out of a channel they can see.
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
