import type { ServerMessage } from "@chief/agent-runtime/types";
import type {
  ConversationMessage,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";

import type { RelayRuntimeRelay } from "./relay-runtime-relay";
import {
  agentRunEvent,
  toChannelEvents,
  toChiefMessage,
} from "./relay-runtime-mappers";

/** A chat's history as the transcript consumes it; `older` pages go above. */
export function historyMessage(
  workspaceId: string,
  chatId: string,
  messages: readonly ConversationMessage[],
  older = false,
): ServerMessage {
  return {
    type: "history",
    workspaceId,
    chatId,
    messages: messages.map((message) => toChiefMessage(message)),
    // An earlier page never changes whether the chat is running now.
    events: older
      ? []
      : messages.flatMap((message) => {
          const event = agentRunEvent(message);
          return event ? [event] : [];
        }),
    running: false,
    ...(older ? { older } : undefined),
  };
}

/** A conversation's messages as channel timeline events. */
export function channelEventsMessage(
  snapshot: WorkspaceSnapshot,
  conversationId: string,
  messages: readonly ConversationMessage[],
  currentPubkey: string | null,
): ServerMessage {
  return {
    type: "channelEvents",
    workspaceId: snapshot.id,
    channelId: conversationId,
    events: messages.flatMap((message) =>
      toChannelEvents(message, snapshot, currentPubkey),
    ),
  };
}

/**
 * A conversation's history, loaded a page at a time from the newest. Each page
 * remembers where the one before it starts, so scrolling back can continue.
 */
export class HistoryPages {
  private readonly before = new Map<string, number>();

  constructor(
    private readonly relay: Pick<RelayRuntimeRelay, "listMessages">,
    private readonly remember: (message: ConversationMessage) => void,
  ) {}

  newest(conversationId: string) {
    return this.page(conversationId);
  }

  /** The page before the last one loaded; none once the start is reached. */
  async older(conversationId: string) {
    const before = this.before.get(conversationId);
    return before ? await this.page(conversationId, before) : undefined;
  }

  private async page(conversationId: string, before?: number) {
    this.before.delete(conversationId);
    const page = await this.relay.listMessages(conversationId, {
      limit: 200,
      recent: true,
      before,
    });
    page.messages.forEach(this.remember);
    if (page.nextSequence) this.before.set(conversationId, page.nextSequence);
    return page.messages;
  }
}
