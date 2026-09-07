import type { z } from "zod";

import type {
  ConversationEvent,
  ConversationMessage,
  Principal,
} from "@chief/relay-contracts";
import {
  appendMessageResultSchema,
  conversationEventPageSchema,
  conversationEventSchema,
  conversationMessageSchema,
  messagePageSchema,
  reactToMessageResultSchema,
} from "@chief/relay-contracts";

import type { UpsertActivityInput } from "./conversation-activity-store";
import type { EventRow, MessageRow } from "./conversation-rows";
import type {
  AppendInput,
  ConversationStore,
  DeleteInput,
  EditInput,
  ReactInput,
} from "./conversation-store-types";
import { upsertAgentActivity } from "./conversation-activity-store";
import {
  escapeLike,
  firstConversationRow as firstRow,
  parseReactions,
  toMessage,
} from "./conversation-rows";
import { initializeConversationStorage } from "./conversation-schema";
import { HttpError } from "./http";
import { countersUpdateUpsertAgentActivity } from "./queries/counters/update-upsert-agent-activity";
import { eventsFindListEvents } from "./queries/events/find-list-events";
import { eventsInsertUpsertAgentActivity } from "./queries/events/insert-upsert-agent-activity";
import { messagesFindRecent } from "./queries/messages/find-recent";
import { messagesFindReplies } from "./queries/messages/find-replies";
import { messagesFindUpsertAgentActivity } from "./queries/messages/find-upsert-agent-activity";
import { messagesInsertAppend } from "./queries/messages/insert-append";
import { listMessageHistory } from "./queries/messages/list-message-history";
import { listMessagePage } from "./queries/messages/list-message-page";
import { messagesUpdateDelete } from "./queries/messages/update-delete";
import { messagesUpdateEdit } from "./queries/messages/update-edit";
import { messagesUpdateReact } from "./queries/messages/update-react";
import { receiptsFindAppend } from "./queries/receipts/find-append";
import { receiptsInsertAppend } from "./queries/receipts/insert-append";
import { consumeSocketTicket, createSocketTicket } from "./socket-ticket-store";

const storedAppendSchema = appendMessageResultSchema.extend({
  event: conversationEventSchema,
});
type StoredAppend = z.infer<typeof storedAppendSchema>;

export class SqlConversationStore implements ConversationStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  initialize() {
    initializeConversationStorage(this.storage);
  }

  async createSocketTicket(principal: Principal) {
    return createSocketTicket(this.storage, principal);
  }

  async consumeSocketTicket(ticket: string) {
    return consumeSocketTicket(this.storage, ticket);
  }

  append(input: AppendInput): StoredAppend {
    return this.storage.transactionSync(() => {
      const prior = firstRow<{ result_json: string }>(
        receiptsFindAppend(this.storage, input.command.commandId),
      );
      if (prior) {
        const stored = storedAppendSchema.parse(JSON.parse(prior.result_json));
        return { ...stored, duplicate: true };
      }

      const counter = firstRow<{ value: number }>(
        countersUpdateUpsertAgentActivity(this.storage),
      );
      if (!counter) throw new Error("Conversation sequence is unavailable.");

      const createdAt = input.command.occurredAt;
      const message = {
        id: input.command.payload.messageId,
        workspaceId: input.workspaceId,
        conversationId: input.command.payload.conversationId,
        threadRootId: input.command.payload.threadRootId,
        author: input.author,
        body: input.command.payload.body,
        mentions: input.command.payload.mentions,
        components: input.command.payload.components,
        reactions: [],
        edited: false,
        deleted: false,
        createdAt,
        sequence: counter.value,
      } satisfies ConversationMessage;
      const event = conversationEventSchema.parse({
        eventId: crypto.randomUUID(),
        sequence: counter.value,
        protocolVersion: 1,
        workspaceId: input.workspaceId,
        streamId: `conversation:${message.conversationId}`,
        type: "conversation.message.appended",
        actor: input.actor,
        correlationId: input.command.commandId,
        causationId: input.command.commandId,
        occurredAt: createdAt,
        payload: { message },
      });
      const result = appendMessageResultSchema.parse({
        duplicate: false,
        message,
      });
      const stored = { ...result, event };

      messagesInsertAppend(this.storage, {
        messageId: message.id,
        commandId: input.command.commandId,
        sequence: message.sequence,
        workspaceId: message.workspaceId,
        conversationId: message.conversationId,
        threadRootId: message.threadRootId ?? null,
        authorKind: message.author.kind,
        authorId: message.author.id,
        body: message.body,
        mentionsJson: JSON.stringify(message.mentions),
        componentsJson: JSON.stringify(message.components),
        createdAt: message.createdAt,
      });
      eventsInsertUpsertAgentActivity(this.storage, {
        sequence: counter.value,
        eventId: event.eventId,
        eventJson: JSON.stringify(event),
      });
      receiptsInsertAppend(
        this.storage,
        input.command.commandId,
        JSON.stringify(stored),
      );
      return stored;
    });
  }

  getMessage(messageId: string): ConversationMessage | null {
    const row = firstRow<MessageRow>(
      messagesFindUpsertAgentActivity(this.storage, messageId),
    );
    return row ? toMessage(row) : null;
  }

  list(after: number, limit: number, query?: string) {
    const normalizedQuery = query?.trim() ?? "";
    const rows = listMessagePage<MessageRow>(this.storage, {
      after: after,
      limit: limit + 1,
      pattern: normalizedQuery ? `%${escapeLike(normalizedQuery)}%` : undefined,
    });
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).map(toMessage);
    return messagePageSchema.parse({
      messages,
      nextSequence: hasMore ? messages.at(-1)?.sequence : null,
    });
  }

  recent(limit: number) {
    const rows = [...messagesFindRecent<MessageRow>(this.storage, limit)];
    return messagePageSchema.parse({
      messages: rows.reverse().map(toMessage),
      nextSequence: null,
    });
  }

  replies(rootId: string, after: number, limit: number) {
    const rows = [
      ...messagesFindReplies<MessageRow>(this.storage, {
        threadRootId: rootId,
        sequence: after,
        limit: limit + 1,
      }),
    ];
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).map(toMessage);
    return messagePageSchema.parse({
      messages,
      nextSequence: hasMore ? messages.at(-1)?.sequence : null,
    });
  }

  history(threadRootId: string | undefined, limit: number) {
    const rows = listMessageHistory<MessageRow>(
      this.storage,
      threadRootId,
      limit,
    );
    return rows.reverse().map(toMessage);
  }

  react(input: ReactInput) {
    return this.storage.transactionSync(() => {
      const row = firstRow<MessageRow>(
        messagesFindUpsertAgentActivity(this.storage, input.messageId),
      );
      if (!row) throw new Error("Unknown message.");
      const reactions = parseReactions(row.reactions_json);
      const entry = reactions.find(
        (reaction) => reaction.emoji === input.emoji,
      );
      const present = entry ? entry.pubkeys.includes(input.pubkey) : false;
      let changed = false;

      if (input.add) {
        if (entry) {
          if (!present) {
            entry.pubkeys.push(input.pubkey);
            changed = true;
          }
        } else {
          reactions.push({ emoji: input.emoji, pubkeys: [input.pubkey] });
          changed = true;
        }
      } else if (entry && present) {
        entry.pubkeys = entry.pubkeys.filter((key) => key !== input.pubkey);
        if (entry.pubkeys.length === 0) {
          reactions.splice(reactions.indexOf(entry), 1);
        }
        changed = true;
      }

      if (changed) {
        const nextReactions = reactions
          .filter((reaction) => reaction.pubkeys.length > 0)
          .slice(0, 128);
        messagesUpdateReact(
          this.storage,
          JSON.stringify(nextReactions),
          input.messageId,
        );
      }

      const updated = toMessage({
        ...row,
        reactions_json: JSON.stringify(reactions),
      });
      const result = reactToMessageResultSchema.parse({
        add: input.add,
        message: updated,
      });
      let event: ConversationEvent | null = null;
      if (changed) {
        event = conversationEventSchema.parse({
          eventId: crypto.randomUUID(),
          sequence: 0,
          protocolVersion: 1,
          workspaceId: input.workspaceId,
          streamId: `conversation:${updated.conversationId}`,
          type: "conversation.message.reacted",
          actor: input.actor,
          correlationId: input.correlationId,
          causationId: input.correlationId,
          occurredAt: new Date().toISOString(),
          payload: { message: updated },
        });
        eventsInsertUpsertAgentActivity(this.storage, {
          sequence: this.nextEventSequence(),
          eventId: event.eventId,
          eventJson: JSON.stringify(event),
        });
      }
      return { changed, result, event };
    });
  }

  edit(input: EditInput) {
    return this.storage.transactionSync(() => {
      const row = firstRow<MessageRow>(
        messagesFindUpsertAgentActivity(this.storage, input.messageId),
      );
      if (!row) {
        throw new HttpError(
          404,
          "message_not_found",
          "The message was not found.",
        );
      }
      const previous = toMessage(row);
      if (previous.body === input.body && previous.edited) {
        return { message: previous, event: null };
      }
      const updated = conversationMessageSchema.parse({
        ...previous,
        body: input.body,
        edited: true,
        deleted: false,
      });
      messagesUpdateEdit(this.storage, updated.body, input.messageId);
      const event = conversationEventSchema.parse({
        eventId: crypto.randomUUID(),
        sequence: this.nextEventSequence(),
        protocolVersion: 1,
        workspaceId: input.workspaceId,
        streamId: `conversation:${updated.conversationId}`,
        type: "conversation.message.edited",
        actor: input.actor,
        correlationId: input.correlationId,
        causationId: input.correlationId,
        occurredAt: new Date().toISOString(),
        payload: { message: updated },
      });
      eventsInsertUpsertAgentActivity(this.storage, {
        sequence: event.sequence,
        eventId: event.eventId,
        eventJson: JSON.stringify(event),
      });
      return { message: updated, event };
    });
  }

  upsertActivity(input: UpsertActivityInput) {
    return upsertAgentActivity(this.storage, input, () =>
      this.nextEventSequence(),
    );
  }

  delete(input: DeleteInput) {
    return this.storage.transactionSync(() => {
      const row = firstRow<MessageRow>(
        messagesFindUpsertAgentActivity(this.storage, input.messageId),
      );
      if (!row) {
        throw new HttpError(
          404,
          "message_not_found",
          "The message was not found.",
        );
      }
      const previous = toMessage(row);
      if (previous.deleted) return { message: previous, event: null };
      const updated = conversationMessageSchema.parse({
        ...previous,
        body: "⚠️ This message was deleted.",
        edited: false,
        deleted: true,
      });
      messagesUpdateDelete(this.storage, updated.body, input.messageId);
      const event = conversationEventSchema.parse({
        eventId: crypto.randomUUID(),
        sequence: this.nextEventSequence(),
        protocolVersion: 1,
        workspaceId: input.workspaceId,
        streamId: `conversation:${updated.conversationId}`,
        type: "conversation.message.deleted",
        actor: input.actor,
        correlationId: input.correlationId,
        causationId: input.correlationId,
        occurredAt: new Date().toISOString(),
        payload: { message: updated },
      });
      eventsInsertUpsertAgentActivity(this.storage, {
        sequence: event.sequence,
        eventId: event.eventId,
        eventJson: JSON.stringify(event),
      });
      return { message: updated, event };
    });
  }

  private nextEventSequence() {
    const counter = firstRow<{ value: number }>(
      countersUpdateUpsertAgentActivity(this.storage),
    );
    if (!counter) throw new Error("Conversation sequence is unavailable.");
    return counter.value;
  }

  listEvents(after: number, limit: number) {
    const rows = [
      ...eventsFindListEvents<EventRow>(this.storage, after, limit + 1),
    ];
    const hasMore = rows.length > limit;
    const events = rows
      .slice(0, limit)
      .map((row) => conversationEventSchema.parse(JSON.parse(row.event_json)));
    return conversationEventPageSchema.parse({
      events,
      nextSequence: hasMore ? events.at(-1)?.sequence : null,
    });
  }
}
