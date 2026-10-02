import {
  channelExternalAccessSchema,
  channelGuestListSchema,
  channelGuestRemoveResultSchema,
  conversationIdSchema,
} from "@chief/relay-contracts";

import { RelayClientBase } from "./relay-client-base";

/** External channel access and the guest agents it admits. */
export class RelayChannelGuestsClient extends RelayClientBase {
  /** Whether the channel is external, and its join link when it is. */
  async external(conversationId: string) {
    return await this.fetchJson(
      this.channelUrl(conversationId, "external"),
      channelExternalAccessSchema,
    );
  }

  /** Makes the channel external, or internal again (removing every guest). */
  async setExternal(conversationId: string, external: boolean) {
    return await this.fetchJson(
      this.channelUrl(conversationId, "external"),
      channelExternalAccessSchema,
      true,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ external }),
      },
    );
  }

  /** Replaces the link. The old one stops working; guests stay. */
  async resetLink(conversationId: string) {
    return await this.fetchJson(
      this.channelUrl(conversationId, "external/reset"),
      channelExternalAccessSchema,
      true,
      { method: "POST" },
    );
  }

  async list(conversationId: string) {
    return (
      await this.fetchJson(
        this.channelUrl(conversationId, "guests"),
        channelGuestListSchema,
      )
    ).guests;
  }

  async remove(conversationId: string, guestId: string) {
    return await this.fetchJson(
      this.channelUrl(
        conversationId,
        `guests/${encodeURIComponent(guestId)}/remove`,
      ),
      channelGuestRemoveResultSchema,
      true,
      { method: "POST" },
    );
  }

  private channelUrl(conversationId: string, suffix: string) {
    const conversation = conversationIdSchema.parse(conversationId);
    return this.workspaceUrl(
      `channels/${encodeURIComponent(conversation)}/${suffix}`,
    );
  }
}
