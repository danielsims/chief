import type {
  AgentActivityComponent,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  conversationEventSchema,
  conversationMessageSchema,
} from "@chief/relay-contracts";

import type { MessageRow } from "./conversation-rows";
import { firstConversationRow, toMessage } from "./conversation-rows";
import { HttpError } from "./http";
import { countersUpdateUpsertAgentActivity } from "./queries/counters/update-upsert-agent-activity";
import { eventsInsertUpsertAgentActivity } from "./queries/events/insert-upsert-agent-activity";
import { messagesFindUpsertAgentActivity } from "./queries/messages/find-upsert-agent-activity";
import { messagesInsertUpsertAgentActivity } from "./queries/messages/insert-upsert-agent-activity";
import { messagesUpdateUpsertAgentActivity } from "./queries/messages/update-upsert-agent-activity";

export interface UpsertActivityInput {
  messageId: string;
  threadRootId?: string;
  component: AgentActivityComponent;
  actor: Principal & { kind: "agent" };
  workspaceId: WorkspaceId;
  conversationId: string;
  correlationId: string;
}

export function upsertAgentActivity(
  storage: DurableObjectStorage,
  input: UpsertActivityInput,
  nextEventSequence: () => number,
) {
  return storage.transactionSync(() => {
    const prior = firstConversationRow<MessageRow>(
      messagesFindUpsertAgentActivity(storage, input.messageId),
    );
    if (
      prior &&
      (prior.author_kind !== "agent" || prior.author_id !== input.actor.agentId)
    ) {
      throw new HttpError(
        403,
        "activity_owner_mismatch",
        "Only the agent that created activity may update it.",
      );
    }
    if (prior) {
      const priorMessage = conversationMessageSchema.parse(toMessage(prior));
      if (
        priorMessage.workspaceId !== input.workspaceId ||
        priorMessage.conversationId !== input.conversationId ||
        priorMessage.threadRootId !== input.threadRootId
      ) {
        throw new HttpError(
          409,
          "activity_scope_mismatch",
          "Activity updates must retain their original workspace, conversation, and thread.",
        );
      }
      const priorComponent = priorMessage.components[0];
      if (
        priorMessage.deleted ||
        priorMessage.components.length !== 1 ||
        priorComponent?.id !== input.component.id ||
        priorComponent.kind !== input.component.kind ||
        priorComponent.version !== input.component.version
      ) {
        throw new HttpError(
          409,
          "activity_identity_mismatch",
          "Activity updates must retain their original message and component identity.",
        );
      }
    }

    const createdAt = prior?.created_at ?? new Date().toISOString();
    let sequence = Number(prior?.sequence ?? 0);
    if (!prior) {
      const counter = firstConversationRow<{ value: number }>(
        countersUpdateUpsertAgentActivity(storage),
      );
      if (!counter) throw new Error("Conversation sequence is unavailable.");
      sequence = counter.value;
    }
    const message = conversationMessageSchema.parse({
      id: input.messageId,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      ...(input.threadRootId
        ? { threadRootId: input.threadRootId }
        : undefined),
      author: { kind: "agent", id: input.actor.agentId },
      body: "",
      mentions: [],
      components: [input.component],
      reactions: [],
      edited: false,
      deleted: false,
      createdAt,
      sequence,
    });

    if (prior) {
      messagesUpdateUpsertAgentActivity(
        storage,
        JSON.stringify(message.components),
        message.id,
      );
    } else {
      messagesInsertUpsertAgentActivity(storage, {
        messageId: message.id,
        commandId: input.correlationId,
        sequence: message.sequence,
        workspaceId: message.workspaceId,
        conversationId: message.conversationId,
        threadRootId: message.threadRootId ?? null,
        authorKind: "agent",
        authorId: input.actor.agentId,
        componentsJson: JSON.stringify(message.components),
        createdAt: message.createdAt,
      });
    }

    const event = conversationEventSchema.parse({
      eventId: crypto.randomUUID(),
      sequence: prior ? nextEventSequence() : message.sequence,
      protocolVersion: 1,
      workspaceId: input.workspaceId,
      streamId: `conversation:${input.conversationId}`,
      type: prior
        ? "conversation.message.edited"
        : "conversation.message.appended",
      actor: input.actor,
      correlationId: input.correlationId,
      causationId: input.correlationId,
      occurredAt: new Date().toISOString(),
      payload: { message },
    });
    eventsInsertUpsertAgentActivity(storage, {
      sequence: event.sequence,
      eventId: event.eventId,
      eventJson: JSON.stringify(event),
    });
    return {
      created: !prior,
      message: prior
        ? toMessage({
            ...prior,
            components_json: JSON.stringify(message.components),
          })
        : message,
      event,
    };
  });
}
