import type {
  ConversationMessage,
  JsonValue,
  MessageReaction,
} from "@chief/relay-contracts";
import {
  conversationMessageSchema,
  messageReactionSchema,
  parseJsonValue,
} from "@chief/relay-contracts";

export interface MessageRow extends Record<string, SqlStorageValue> {
  message_id: string;
  sequence: number;
  workspace_id: string;
  conversation_id: string;
  thread_root_id: string | null;
  author_kind: "user" | "agent" | "system";
  author_id: string;
  body: string;
  mentions_json: string;
  components_json: string;
  reactions_json: string;
  edited: number;
  deleted: number;
  created_at: string;
}

export interface EventRow extends Record<string, SqlStorageValue> {
  sequence: number;
  event_json: string;
}

function parseStoredJson(json: string): JsonValue {
  const value: unknown = JSON.parse(json);
  const parsed = parseJsonValue(value);
  if (parsed === undefined) {
    throw new Error("Stored conversation JSON is invalid.");
  }
  return parsed;
}

export function toMessage(row: MessageRow): ConversationMessage {
  return conversationMessageSchema.parse({
    id: row.message_id,
    sequence: row.sequence,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    threadRootId: row.thread_root_id ?? undefined,
    author: { kind: row.author_kind, id: row.author_id },
    body: row.body,
    mentions: parseStoredJson(row.mentions_json),
    components: parseStoredJson(row.components_json),
    reactions: parseReactions(row.reactions_json),
    edited: Number(row.edited) === 1,
    deleted: Number(row.deleted) === 1,
    createdAt: row.created_at,
  });
}

export function parseReactions(json: string): MessageReaction[] {
  const parsed = parseStoredJson(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const result = messageReactionSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

export function escapeLike(value: string) {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/%/gu, "\\%")
    .replace(/_/gu, "\\_");
}

export function firstConversationRow<T>(cursor: Iterable<T>): T | undefined {
  for (const row of cursor) return row;
  return undefined;
}
