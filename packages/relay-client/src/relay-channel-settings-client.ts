import type { JsonValue } from "@chief/relay-contracts";
import {
  channelArchiveCommandSchema,
  channelDeleteCommandSchema,
  channelDeleteResultSchema,
  channelRecordSchema,
  channelUnarchiveCommandSchema,
  channelUpdateCommandSchema,
  conversationIdSchema,
} from "@chief/relay-contracts";

import { RelayClientBase } from "./relay-client-base";

type ChannelCommand =
  | ReturnType<typeof channelUpdateCommandSchema.parse>
  | ReturnType<typeof channelArchiveCommandSchema.parse>
  | ReturnType<typeof channelDeleteCommandSchema.parse>;

/** Renaming, visibility, archiving and permanent deletion of a channel. */
export class RelayChannelSettingsClient extends RelayClientBase {
  async update(
    conversationId: string,
    input: { name?: string; isPrivate?: boolean },
  ) {
    const conversation = conversationIdSchema.parse(conversationId);
    return await this.command(
      conversation,
      "update",
      channelRecordSchema,
      channelUpdateCommandSchema.parse(
        this.envelope({ conversationId: conversation, ...input }),
      ),
    );
  }

  async setArchived(conversationId: string, archived: boolean) {
    const conversation = conversationIdSchema.parse(conversationId);
    const payload = this.envelope({ conversationId: conversation });
    return await this.command(
      conversation,
      archived ? "archive" : "unarchive",
      channelRecordSchema,
      archived
        ? channelArchiveCommandSchema.parse(payload)
        : channelUnarchiveCommandSchema.parse(payload),
    );
  }

  /** Permanent: the channel, its members, guests and history are removed. */
  async delete(conversationId: string) {
    const conversation = conversationIdSchema.parse(conversationId);
    return await this.command(
      conversation,
      "delete",
      channelDeleteResultSchema,
      channelDeleteCommandSchema.parse(
        this.envelope({ conversationId: conversation }),
      ),
    );
  }

  private envelope<Payload>(payload: Payload) {
    return {
      commandId: crypto.randomUUID(),
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload,
    };
  }

  private async command<Result>(
    conversationId: string,
    action: string,
    schema: { parse: (value: JsonValue) => Result },
    body: ChannelCommand,
  ) {
    return await this.fetchJson(
      this.workspaceUrl(
        `channels/${encodeURIComponent(conversationId)}/${action}`,
      ),
      schema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }
}
