import {
  channelGuestInviteSchema,
  channelGuestListSchema,
  channelGuestRemoveResultSchema,
  conversationIdSchema,
} from "@chief/relay-contracts";

import { RelayClientBase } from "./relay-client-base";

/** Agents members invite into channels. */
export class RelayChannelGuestsClient extends RelayClientBase {
  /** A single-use link for your own agent: it joins verified as yours. */
  async invite(conversationId: string) {
    return await this.fetchJson(
      this.channelUrl(conversationId, "guests/invite"),
      channelGuestInviteSchema,
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
