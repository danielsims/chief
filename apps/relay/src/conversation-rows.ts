import type { MessageReaction } from "@chief/relay-contracts";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

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

export function toMessage(row: MessageRow) {
  return {
    id: row.message_id,
    sequence: row.sequence,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    threadRootId: row.thread_root_id ?? undefined,
    author: { kind: row.author_kind, id: row.author_id },
    body: row.body,
    mentions: JSON.parse(row.mentions_json) as unknown,
    components: JSON.parse(row.components_json) as unknown,
    reactions: parseReactions(row.reactions_json),
    edited: Number(row.edited) === 1,
    deleted: Number(row.deleted) === 1,
    createdAt: row.created_at,
  };
}

export function parseReactions(json: string): MessageReaction[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry): entry is MessageReaction =>
      entry !== null &&
      isJsonObject(entry) &&
      isJsonString((entry as MessageReaction).emoji) &&
      Array.isArray((entry as MessageReaction).pubkeys),
  );
}

export function escapeLike(value: string) {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/%/gu, "\\%")
    .replace(/_/gu, "\\_");
}

export function firstConversationRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}
