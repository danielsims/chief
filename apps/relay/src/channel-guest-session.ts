import { z } from "zod";

import type {
  ChannelGuestDeliveryInput,
  ChannelGuestMessage,
  ChannelGuestPostInput,
  ConversationMessage,
} from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  appendMessageResultSchema,
  channelGuestDeliveryInputSchema,
  channelGuestMessagePageSchema,
  channelGuestPostInputSchema,
  conversationMessageSchema,
  messagePageSchema,
} from "@chief/relay-contracts";

import type { ChannelGuestRow } from "./queries/channel-guests/guests";
import {
  GUEST_CREDENTIAL_HEADER,
  guestTokenFrom,
  sha256Hex,
} from "./channel-guest-crypto";
import {
  ChannelGuestDelivery,
  guestSubscribeSchema,
  guestUnsubscribeSchema,
} from "./channel-guest-delivery";
import { ChannelGuestBase, clampInteger } from "./channel-guest-shared";
import { HttpError, json, parseJson } from "./http";
import { withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import {
  channelGuestsFind,
  channelGuestsFindByTokenHash,
  channelGuestsUpdate,
  channelGuestThreadsInsert,
} from "./queries/channel-guests/guests";
import { workspaceAgentNames } from "./workspace-agent-runtime";
import { WorkspaceLiveStore } from "./workspace-live-store";
import { memberDisplayNames } from "./workspace-member-names";

const singleMessageSchema = z.object({ message: conversationMessageSchema });
const postWindowMs = 10 * 60 * 1_000;
const maximumPostsPerWindow = 30;

/** Everything an admitted guest agent can do: read and post in its one
 * channel, configure how it is woken, and leave. */
export class ChannelGuestSession extends ChannelGuestBase {
  async route(request: Request, operation: string, origin: string) {
    const url = new URL(request.url);
    const guest = await this.authenticate(request);
    const delivery = new ChannelGuestDelivery(this.storage, this.env);
    switch (operation) {
      case "guest-me":
        return json(
          this.describeSelf(
            guest,
            origin,
            guestTokenFrom(request.headers.get(GUEST_CREDENTIAL_HEADER)) ?? "",
          ),
        );
      case "guest-messages":
        this.requireActive(guest);
        return json(
          await this.readMessages(
            guest,
            url.searchParams.get("after"),
            url.searchParams.get("limit"),
          ),
        );
      case "guest-thread":
        this.requireActive(guest);
        return json(
          await this.readThread(guest, url.searchParams.get("messageId") ?? ""),
        );
      case "guest-post":
        this.requireActive(guest);
        return json(
          await this.post(
            guest,
            channelGuestPostInputSchema.parse(await parseJson(request)),
          ),
          {
            status: 201,
          },
        );
      case "guest-delivery":
        this.requireActive(guest);
        return json(
          await this.setDelivery(
            guest,
            channelGuestDeliveryInputSchema.parse(await parseJson(request)),
          ),
        );
      case "guest-listen":
        this.requireActive(guest);
        return json(await this.listenTicket(guest, origin));
      case "guest-leave":
        this.remove(guest);
        return json({ left: true });
      case "guest-events-subscribe":
        this.requireActive(guest);
        return json(
          await delivery.subscribe(
            guest,
            guestSubscribeSchema.parse(await parseJson(request)),
          ),
        );
      case "guest-events-unsubscribe":
        return json(
          delivery.unsubscribe(
            guest,
            guestUnsubscribeSchema.parse(await parseJson(request)),
          ),
        );
    }
    throw new HttpError(404, "not_found", "Guest operation not found.");
  }

  /** A one-time ticket for `chief-listen` to open its listener socket, so
   * the long-lived token never travels in a URL. */
  private async listenTicket(guest: ChannelGuestRow, origin: string) {
    const { ticket, expiresAt } = await new WorkspaceLiveStore(
      this.storage,
    ).createSocketTicket(this.guestContext(guest).principal);
    const url = new URL("/v1/connect", origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("workspaceId", this.workspace().id);
    url.searchParams.set("ticket", ticket);
    return { url: url.toString(), expiresAt };
  }

  private async authenticate(request: Request) {
    const token = guestTokenFrom(request.headers.get(GUEST_CREDENTIAL_HEADER));
    const guest = token
      ? channelGuestsFindByTokenHash(this.storage, await sha256Hex(token))
      : undefined;
    if (guest?.status !== "active") {
      throw new HttpError(
        401,
        "guest_unauthorized",
        "This guest credential is invalid or was removed.",
      );
    }
    const seen = guest.last_seen_at ? Date.parse(guest.last_seen_at) : 0;
    if (Date.now() - seen > 60_000) {
      channelGuestsUpdate(this.storage, guest.guest_id, {
        last_seen_at: new Date().toISOString(),
      });
    }
    return guest;
  }

  private requireActive(guest: ChannelGuestRow) {
    const channel = this.channels.requireChannel(guest.conversation_id);
    if (!this.channels.agentMayAccess(channel, guest.operator_user_id)) {
      throw new HttpError(
        403,
        "channel_unavailable",
        "You no longer have access to this channel.",
      );
    }
    return channel;
  }

  private describeSelf(guest: ChannelGuestRow, origin: string, token: string) {
    const channel = this.channels.requireChannel(guest.conversation_id);
    const workspace = this.workspace();
    return {
      guest: this.summary(guest),
      workspace: { name: workspace.name },
      channel: {
        name: channel.name,
        description: channel.description,
        open: this.channels.agentMayAccess(channel, guest.operator_user_id),
      },
      api: this.apiUrls(origin, token),
    };
  }

  private async readMessages(
    guest: ChannelGuestRow,
    rawAfter: string | null,
    rawLimit: string | null,
  ) {
    const limit = clampInteger(rawLimit, 30, 1, 100);
    const after = rawAfter === null ? null : clampInteger(rawAfter, 0, 0);
    const url = new URL("https://conversation.internal/messages");
    url.searchParams.set("limit", String(limit));
    if (after === null) url.searchParams.set("recent", "true");
    else url.searchParams.set("after", String(after));
    const page = await this.conversationRead(guest, url);
    return this.guestPage(guest, page.messages);
  }

  private async readThread(guest: ChannelGuestRow, messageId: string) {
    const root = await this.conversationRead(
      guest,
      new URL(
        `https://conversation.internal/messages/${encodeURIComponent(messageId)}`,
      ),
      true,
    );
    const replies = await this.conversationRead(
      guest,
      new URL(
        `https://conversation.internal/messages/${encodeURIComponent(messageId)}/replies?limit=100`,
      ),
    );
    return this.guestPage(guest, [...root.messages, ...replies.messages]);
  }

  private async conversationRead(
    guest: ChannelGuestRow,
    url: URL,
    single = false,
  ) {
    const response = await this.conversation(guest).fetch(
      withTrustedContext(new Request(url), this.guestContext(guest)),
    );
    if (!response.ok) {
      await releaseInternalResponse(response);
      throw new HttpError(
        response.status === 404 ? 404 : 502,
        "guest_read_failed",
        response.status === 404
          ? "That message was not found."
          : "The channel could not be read.",
      );
    }
    const value = await response.json();
    if (single) {
      return { messages: [singleMessageSchema.parse(value).message] };
    }
    return messagePageSchema.parse(value);
  }

  private guestPage(
    guest: ChannelGuestRow,
    messages: readonly ConversationMessage[],
  ) {
    const people = memberDisplayNames(this.storage);
    const agents = workspaceAgentNames(this.storage);
    const projected = messages
      .filter((message) => !message.deleted && message.body.trim() !== "")
      .map((message): ChannelGuestMessage => ({
        id: message.id,
        threadRootId: message.threadRootId ?? null,
        author: {
          kind:
            message.author.kind === "user"
              ? "person"
              : message.author.kind === "guest"
                ? "guest"
                : message.author.kind === "agent"
                  ? "agent"
                  : "system",
          name:
            message.author.kind === "guest"
              ? message.author.name
              : message.author.kind === "user"
                ? (people.get(`user:${message.author.id}`) ?? "Member")
                : message.author.kind === "agent"
                  ? (agents.get(message.author.id) ?? "Agent")
                  : "Chief",
          you:
            message.author.kind === "guest" &&
            message.author.id === guest.guest_id,
        },
        body: message.body,
        createdAt: message.createdAt,
        cursor: message.sequence,
      }));
    return channelGuestMessagePageSchema.parse({
      messages: projected,
      cursor: messages.reduce(
        (highest, message) => Math.max(highest, message.sequence),
        0,
      ),
    });
  }

  private async post(guest: ChannelGuestRow, input: ChannelGuestPostInput) {
    this.consumePostAllowance(guest);
    const messageId = input.idempotencyKey ?? crypto.randomUUID();
    if (input.threadRootId) {
      // Throws when the root is not in this channel.
      await this.readThread(guest, input.threadRootId);
    }
    const command = appendMessageCommandSchema.parse({
      commandId: messageId,
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        messageId,
        conversationId: guest.conversation_id,
        threadRootId: input.threadRootId,
        body: input.body,
        mentions: [],
        components: [],
      },
    });
    const response = await this.conversation(guest).fetch(
      withTrustedContext(
        new Request(
          `https://relay.internal/v1/workspaces/${encodeURIComponent(this.workspace().id)}/conversations/${encodeURIComponent(guest.conversation_id)}/messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(command),
          },
        ),
        this.guestContext(guest),
      ),
    );
    if (!response.ok) {
      await releaseInternalResponse(response);
      throw new HttpError(
        502,
        "guest_post_failed",
        "The message was not sent.",
      );
    }
    const result = appendMessageResultSchema.parse(await response.json());
    channelGuestThreadsInsert(
      this.storage,
      guest.guest_id,
      result.message.threadRootId ?? result.message.id,
    );
    if (!result.duplicate) {
      await new ChannelGuestDelivery(this.storage, this.env).fanOut(
        result.message,
      );
    }
    return {
      id: result.message.id,
      threadRootId: result.message.threadRootId ?? null,
      cursor: result.message.sequence,
    };
  }

  private consumePostAllowance(guest: ChannelGuestRow) {
    const now = Date.now();
    const started = guest.post_window_started_at
      ? Date.parse(guest.post_window_started_at)
      : 0;
    const fresh = now - started > postWindowMs;
    const count = fresh ? 0 : guest.post_window_count;
    if (count >= maximumPostsPerWindow) {
      throw new HttpError(
        429,
        "guest_rate_limited",
        "Too many messages. Wait a few minutes before posting again.",
      );
    }
    channelGuestsUpdate(this.storage, guest.guest_id, {
      post_window_started_at: fresh
        ? new Date(now).toISOString()
        : guest.post_window_started_at,
      post_window_count: count + 1,
    });
  }

  private async setDelivery(
    guest: ChannelGuestRow,
    input: ChannelGuestDeliveryInput,
  ) {
    const update: Partial<ChannelGuestRow> = {};
    if (input.wake) update.wake = input.wake;
    let signingSecret: string | undefined;
    if (input.webhook === null) {
      update.webhook_url = null;
      update.webhook_authorization = null;
      update.webhook_secret = null;
    } else if (input.webhook) {
      const sealed = await this.sealedWebhook(input.webhook);
      signingSecret = sealed.signingSecret;
      Object.assign(update, sealed.columns);
    }
    channelGuestsUpdate(this.storage, guest.guest_id, update);
    const next = channelGuestsFind(this.storage, guest.guest_id) ?? guest;
    return {
      guest: this.summary(next),
      ...(signingSecret ? { signingSecret } : undefined),
    };
  }
}
