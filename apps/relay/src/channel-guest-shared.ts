import type { GuestPrincipal, WorkspaceId } from "@chief/relay-contracts";
import {
  channelGuestSummarySchema,
  conversationIdSchema,
  guestIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import type { ChannelGuestRow } from "./queries/channel-guests/guests";
import {
  newWebhookSecret,
  requirePublicHttpsUrl,
  seal,
} from "./channel-guest-crypto";
import { ChannelGuestDelivery } from "./channel-guest-delivery";
import { revokeGuest } from "./channel-guest-lifecycle";
import { HttpError } from "./http";
import { workspaceFindAuthorize } from "./queries/workspace/find-authorize";
import { firstRow, WorkspaceChannelStore } from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";

export const GUEST_GATEWAY_SERVICE = "channel-guest-gateway";
export const PUBLIC_ORIGIN_HEADER = "x-chief-public-origin";

/** State and helpers shared by the member-facing guest service and the
 * guest-facing session. */
export class ChannelGuestBase {
  protected readonly channels: WorkspaceChannelStore;

  constructor(
    protected readonly storage: DurableObjectStorage,
    protected readonly env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
  }

  protected apiUrls(origin: string, token: string) {
    const base = `${origin}/v1/workspaces/${encodeURIComponent(this.workspace().id)}/guest`;
    return { base, mcp: `${base}/mcp`, mcpWithToken: `${base}/mcp/${token}` };
  }

  protected remove(guest: ChannelGuestRow) {
    this.storage.transactionSync(() => revokeGuest(this.storage, guest));
  }

  protected async sealedWebhook(input: {
    url: string;
    authorization?: string | undefined;
  }) {
    const master = this.env.RELAY_SECRET_KEY;
    const signingSecret = newWebhookSecret();
    const columns = {
      webhook_url: requirePublicHttpsUrl(input.url),
      webhook_authorization: input.authorization
        ? await seal(master, input.authorization)
        : null,
      webhook_secret: await seal(master, signingSecret),
    };
    return { signingSecret, columns };
  }

  protected summary(guest: ChannelGuestRow) {
    return channelGuestSummarySchema.parse({
      id: guest.guest_id,
      name: guest.name,
      about: guest.about,
      image: guest.avatar_url,
      status: guest.status,
      wake: guest.wake,
      delivery: guest.webhook_url
        ? "webhook"
        : new ChannelGuestDelivery(this.storage, this.env).hasSubscriptions(
              guest.guest_id,
            )
          ? "events"
          : "poll",
      createdAt: guest.created_at,
      lastSeenAt: guest.last_seen_at,
    });
  }

  protected conversation(guest: ChannelGuestRow) {
    return this.env.CONVERSATIONS.get(
      this.env.CONVERSATIONS.idFromName(
        `${this.workspace().id}:${guest.conversation_id}`,
      ),
    );
  }

  protected guestContext(guest: ChannelGuestRow) {
    const workspaceId: WorkspaceId = workspaceIdSchema.parse(
      this.workspace().id,
    );
    const principal: GuestPrincipal = {
      kind: "guest",
      guestId: guestIdSchema.parse(guest.guest_id),
      name: guest.name,
      ...(guest.avatar_url ? { image: guest.avatar_url } : undefined),
      workspaceId,
      conversationId: conversationIdSchema.parse(guest.conversation_id),
    };
    return {
      principal,
      requestId: crypto.randomUUID(),
      workspaceId,
      conversationId: guest.conversation_id,
    };
  }

  protected workspace() {
    const row = firstRow<{
      snapshot_json: string | null;
      workspace_id: string;
    }>(workspaceFindAuthorize(this.storage));
    if (!row) throw linkNotFound();
    const snapshot = row.snapshot_json
      ? decodeWorkspaceSnapshot(row.snapshot_json)
      : null;
    return {
      id: row.workspace_id,
      name: snapshot?.name ?? "Chief workspace",
    };
  }
}

export { isExternalChannel } from "./channel-guest-lifecycle";

export function clampInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

export function linkNotFound() {
  return new HttpError(
    404,
    "channel_link_not_found",
    "This link is no longer active.",
  );
}

export function linkDenied() {
  return new HttpError(
    403,
    "channel_link_denied",
    "Only workspace members can share a channel.",
  );
}
