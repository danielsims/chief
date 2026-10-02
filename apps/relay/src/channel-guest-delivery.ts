import { z } from "zod";

import type { ConversationMessage } from "@chief/relay-contracts";
import { channelGuestWakeSchema } from "@chief/relay-contracts";

import type { ChannelGuestRow } from "./queries/channel-guests/guests";
import {
  requirePublicHttpsUrl,
  requireWebhookSecret,
  seal,
  sha256Hex,
  signStandardWebhook,
  unseal,
} from "./channel-guest-crypto";
import { isExternalChannel } from "./channel-guest-lifecycle";
import { HttpError } from "./http";
import {
  channelGuestOutboxCountForGuest,
  channelGuestOutboxDelete,
  channelGuestOutboxDeleteForGuest,
  channelGuestOutboxDue,
  channelGuestOutboxInsert,
  channelGuestOutboxNext,
  channelGuestOutboxReschedule,
  channelGuestSubscriptionsDelete,
  channelGuestSubscriptionsFind,
  channelGuestSubscriptionsList,
  channelGuestSubscriptionsUpsert,
} from "./queries/channel-guests/delivery";
import {
  channelGuestsFind,
  channelGuestsListForConversation,
  channelGuestThreadsHas,
} from "./queries/channel-guests/guests";
import { workspaceAgentNames } from "./workspace-agent-runtime";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { memberDisplayNames } from "./workspace-member-names";

const challengeSchema = z.object({ challenge: z.string() });

/** The one MCP event a guest can subscribe to. */
export const CHANNEL_MESSAGE_EVENT = "channel.message";

const retryDelaysMs = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];
const maximumQueuedPerGuest = 50;
const deliveryTimeoutMs = 10_000;
const subscriptionLifetimeMs = 24 * 60 * 60 * 1_000;
const maximumSubscriptionsPerGuest = 5;

export const guestSubscribeSchema = z.object({
  name: z.literal(CHANNEL_MESSAGE_EVENT),
  arguments: z
    .object({ wake: channelGuestWakeSchema.optional() })

    .default({}),
  delivery: z.object({
    mode: z.literal("webhook"),
    url: z.string().max(2_048),
    secret: z.string().max(256),
  }),
  cursor: z.string().nullable().optional(),
  ttlMs: z.number().int().positive().nullable().optional(),
});

export const guestUnsubscribeSchema = z.object({
  name: z.literal(CHANNEL_MESSAGE_EVENT),
  arguments: z
    .object({ wake: channelGuestWakeSchema.optional() })

    .optional(),
  delivery: z.object({
    mode: z.literal("webhook"),
    url: z.string().max(2_048),
  }),
});

interface Payload {
  eventId: string;
  name: typeof CHANNEL_MESSAGE_EVENT;
  timestamp: string;
  data: {
    channel: { name: string };
    reason: "mention" | "thread" | "all";
    message: {
      id: string;
      threadRootId: string | null;
      author: { kind: "person" | "agent" | "guest"; name: string };
      text: string;
      truncated: boolean;
    };
    reply: { threadRootId: string };
  };
  cursor: string;
}

/**
 * Wakes guest agents. Agents without an inbound endpoint poll instead; agents
 * with one (Grok Bot routines, OpenClaw hooks, ChatGPT and dots through MCP
 * Events) receive one Standard Webhooks-signed event per relevant message.
 * Message text is delivered as data, never as instructions.
 */
export class ChannelGuestDelivery {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
  ) {}

  hasSubscriptions(guestId: string) {
    return channelGuestSubscriptionsList(this.storage, guestId).length > 0;
  }

  async fanOut(message: ConversationMessage) {
    if (message.deleted || message.body.trim() === "") return;
    const guests = channelGuestsListForConversation(
      this.storage,
      message.conversationId,
      ["active"],
    );
    if (guests.length === 0) return;
    const channel = new WorkspaceChannelStore(
      this.storage,
      this.env,
    ).requireChannel(message.conversationId);
    // Guests only ever hear about external channels.
    if (!isExternalChannel(channel)) return;
    const author = this.authorOf(message);
    let queued = false;
    for (const guest of guests) {
      if (
        message.author.kind === "guest" &&
        message.author.id === guest.guest_id
      )
        continue;
      const reason = this.wakeReason(guest, message);
      if (!reason) continue;
      const targets: (string | null)[] = [
        ...(guest.webhook_url ? [null] : []),
        ...channelGuestSubscriptionsList(this.storage, guest.guest_id).map(
          (subscription) => subscription.subscription_id,
        ),
      ];
      // A guest that stops answering gets no more than this backlog; it can
      // always catch up by reading the channel.
      if (
        targets.length === 0 ||
        channelGuestOutboxCountForGuest(this.storage, guest.guest_id) >=
          maximumQueuedPerGuest
      )
        continue;
      const text = message.body.slice(0, 4_000);
      for (const subscriptionId of targets) {
        const eventId = `evt_${(
          await sha256Hex(`${guest.guest_id}:${subscriptionId}:${message.id}`)
        ).slice(0, 32)}`;
        const payload: Payload = {
          eventId,
          name: CHANNEL_MESSAGE_EVENT,
          timestamp: message.createdAt,
          data: {
            channel: { name: String(channel.name) },
            reason,
            message: {
              id: message.id,
              threadRootId: message.threadRootId ?? null,
              author,
              text,
              truncated: text.length < message.body.length,
            },
            reply: { threadRootId: message.threadRootId ?? message.id },
          },
          cursor: String(message.sequence),
        };
        const now = new Date().toISOString();
        channelGuestOutboxInsert(this.storage, {
          delivery_id: eventId,
          guest_id: guest.guest_id,
          subscription_id: subscriptionId,
          payload_json: JSON.stringify(payload),
          attempts: 0,
          next_attempt_at: now,
          created_at: now,
        });
        queued = true;
      }
    }
    if (queued) await this.scheduleDrain(Date.now());
  }

  /** Mentions and threads always wake; "all" adds every other message.
   * Guests only wake each other by explicit mention, so two agents cannot
   * loop on a thread. */
  private wakeReason(guest: ChannelGuestRow, message: ConversationMessage) {
    if (mentions(message.body, guest.name)) return "mention" as const;
    if (message.author.kind === "guest") return null;
    if (
      message.threadRootId &&
      channelGuestThreadsHas(this.storage, guest.guest_id, message.threadRootId)
    ) {
      return "thread" as const;
    }
    return guest.wake === "all" ? ("all" as const) : null;
  }

  private authorOf(
    message: ConversationMessage,
  ): Payload["data"]["message"]["author"] {
    if (message.author.kind === "guest") {
      return { kind: "guest", name: message.author.name };
    }
    if (message.author.kind === "agent") {
      return {
        kind: "agent",
        name:
          workspaceAgentNames(this.storage).get(message.author.id) ?? "Agent",
      };
    }
    return {
      kind: "person",
      name:
        memberDisplayNames(this.storage).get(`user:${message.author.id}`) ??
        "Member",
    };
  }

  // MCP Events ------------------------------------------------------------

  async subscribe(
    guest: ChannelGuestRow,
    input: z.infer<typeof guestSubscribeSchema>,
  ) {
    const url = requirePublicHttpsUrl(input.delivery.url);
    const secret = requireWebhookSecret(input.delivery.secret);
    const wake = input.arguments.wake ?? guest.wake;
    const subscriptionId = `sub_${(
      await sha256Hex(
        `${guest.guest_id}:${url}:${CHANNEL_MESSAGE_EVENT}:${JSON.stringify({ wake })}`,
      )
    ).slice(0, 32)}`;
    const existing = channelGuestSubscriptionsFind(
      this.storage,
      subscriptionId,
    );
    if (
      !existing &&
      channelGuestSubscriptionsList(this.storage, guest.guest_id).length >=
        maximumSubscriptionsPerGuest
    ) {
      throw new HttpError(
        409,
        "subscription_limit_reached",
        "This guest already has the maximum number of subscriptions.",
      );
    }
    if (!existing) await this.verifyCallback(url, secret, subscriptionId);
    const refreshBefore = new Date(
      Date.now() + subscriptionLifetimeMs,
    ).toISOString();
    channelGuestSubscriptionsUpsert(this.storage, {
      subscription_id: subscriptionId,
      guest_id: guest.guest_id,
      wake,
      url,
      secret: await seal(this.env.RELAY_SECRET_KEY, secret),
      refresh_before: refreshBefore,
      created_at: existing?.created_at ?? new Date().toISOString(),
    });
    return {
      id: subscriptionId,
      refreshBefore,
      cursor: null,
      truncated: false,
    };
  }

  unsubscribe(
    guest: ChannelGuestRow,
    input: z.infer<typeof guestUnsubscribeSchema>,
  ) {
    for (const subscription of channelGuestSubscriptionsList(
      this.storage,
      guest.guest_id,
    )) {
      if (subscription.url !== input.delivery.url) continue;
      channelGuestSubscriptionsDelete(
        this.storage,
        subscription.subscription_id,
      );
      channelGuestOutboxDeleteForGuest(
        this.storage,
        guest.guest_id,
        subscription.subscription_id,
      );
    }
    return {};
  }

  private async verifyCallback(
    url: string,
    secret: string,
    subscriptionId: string,
  ) {
    const challenge = crypto.randomUUID();
    const body = JSON.stringify({ type: "verification", challenge });
    const id = `msg_verification_${challenge.slice(0, 8)}`;
    let echoed: string | undefined;
    try {
      const response = await this.post(url, body, {
        id,
        secret,
        subscriptionId,
      });
      echoed = response.ok
        ? challengeSchema.safeParse(await response.json()).data?.challenge
        : undefined;
    } catch {
      echoed = undefined;
    }
    if (echoed !== challenge) {
      throw new HttpError(
        400,
        "callback_verification_failed",
        "The callback did not echo the verification challenge.",
        { reason: "challenge_failed" },
      );
    }
  }

  // Outbox ----------------------------------------------------------------

  async drain() {
    const due = channelGuestOutboxDue(
      this.storage,
      new Date().toISOString(),
      25,
    );
    const channels = new WorkspaceChannelStore(this.storage, this.env);
    for (const row of due) {
      const guest = channelGuestsFind(this.storage, row.guest_id);
      const subscription = row.subscription_id
        ? channelGuestSubscriptionsFind(this.storage, row.subscription_id)
        : undefined;
      const url = row.subscription_id ? subscription?.url : guest?.webhook_url;
      const sealedSecret = row.subscription_id
        ? subscription?.secret
        : guest?.webhook_secret;
      const channelOpen =
        guest !== undefined &&
        isExternalChannel(channels.requireChannel(guest.conversation_id));
      if (guest?.status !== "active" || !channelOpen || !url || !sealedSecret) {
        channelGuestOutboxDelete(this.storage, row.delivery_id);
        continue;
      }
      let status = 0;
      try {
        const response = await this.post(url, row.payload_json, {
          id: row.delivery_id,
          secret: await unseal(this.env.RELAY_SECRET_KEY, sealedSecret),
          ...(row.subscription_id
            ? { subscriptionId: row.subscription_id }
            : undefined),
          ...(!row.subscription_id && guest.webhook_authorization
            ? {
                authorization: await unseal(
                  this.env.RELAY_SECRET_KEY,
                  guest.webhook_authorization,
                ),
              }
            : undefined),
        });
        status = response.status;
        await response.body?.cancel();
      } catch {
        status = 0;
      }
      const delay = retryDelaysMs[row.attempts];
      if (
        (status >= 200 && status < 300) ||
        (status >= 400 && status < 500 && status !== 408 && status !== 429) ||
        delay === undefined
      ) {
        channelGuestOutboxDelete(this.storage, row.delivery_id);
        continue;
      }
      channelGuestOutboxReschedule(
        this.storage,
        row.delivery_id,
        row.attempts + 1,
        new Date(Date.now() + delay).toISOString(),
      );
    }
    const next = channelGuestOutboxNext(this.storage);
    if (next) await this.scheduleDrain(Date.parse(next.next));
  }

  private async post(
    url: string,
    body: string,
    signing: {
      id: string;
      secret: string;
      subscriptionId?: string;
      authorization?: string;
    },
  ) {
    const timestamp = Math.floor(Date.now() / 1_000);
    const headers = new Headers({
      "content-type": "application/json",
      "user-agent": "Chief-Relay/1",
      "webhook-id": signing.id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": await signStandardWebhook(
        signing.secret,
        signing.id,
        timestamp,
        body,
      ),
    });
    if (signing.subscriptionId) {
      headers.set("x-mcp-subscription-id", signing.subscriptionId);
    }
    if (signing.authorization)
      headers.set("authorization", signing.authorization);
    return fetch(requirePublicHttpsUrl(url), {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(deliveryTimeoutMs),
    });
  }

  private async scheduleDrain(at: number) {
    const current = await this.storage.getAlarm();
    const target = Math.max(at, Date.now() + 250);
    if (current === null || current > target) {
      await this.storage.setAlarm(target);
    }
  }
}

function mentions(body: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_])@${escaped}(?![\\p{L}\\p{N}_])`,
    "iu",
  ).test(body);
}
