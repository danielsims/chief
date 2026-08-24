import type {
  AgentActivityComponent,
  ConversationMessage,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import { conversationMessageSchema } from "@chief/relay-contracts";

import type { MessageRow } from "./conversation-rows";
import { firstConversationRow, toMessage } from "./conversation-rows";
import { HttpError } from "./http";

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
      storage.sql.exec(
        "SELECT * FROM messages WHERE message_id = ?",
        input.messageId,
      ),
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
        storage.sql.exec(
          "UPDATE counters SET value = value + 1 WHERE name = 'sequence' RETURNING value",
        ),
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
      storage.sql.exec(
        "UPDATE messages SET components_json = ? WHERE message_id = ?",
        JSON.stringify(message.components),
        message.id,
      );
    } else {
      storage.sql.exec(
        `INSERT INTO messages (
          message_id, command_id, sequence, workspace_id, conversation_id,
          thread_root_id, author_kind, author_id, body, mentions_json,
          components_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '[]', ?, ?)`,
        message.id,
        input.correlationId,
        message.sequence,
        message.workspaceId,
        message.conversationId,
        message.threadRootId ?? null,
        "agent",
        input.actor.agentId,
        JSON.stringify(message.components),
        message.createdAt,
      );
    }

    const event = {
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
    };
    storage.sql.exec(
      "INSERT INTO events (sequence, event_id, event_json) VALUES (?, ?, ?)",
      event.sequence,
      event.eventId,
      JSON.stringify(event),
    );
    return {
      created: !prior,
      message: (prior
        ? toMessage({
            ...prior,
            components_json: JSON.stringify(message.components),
          })
        : message) as ConversationMessage,
      event,
    };
  });
}
