import type {
  ConversationMessage,
  GuestProfile,
  JsonValue,
  MessageReaction,
} from "@chief/relay-contracts";
import {
  conversationMessageSchema,
  guestProfileSchema,
  messageReactionSchema,
  parseJsonValue,
} from "@chief/relay-contracts";

export interface MessageRow extends Record<string, SqlStorageValue> {
  message_id: string;
  sequence: number;
  workspace_id: string;
  conversation_id: string;
  thread_root_id: string | null;
  author_kind: "user" | "agent" | "system" | "guest";
  author_id: string;
  author_profile: string | null;
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

/** The appearance a guest author had when it posted. A missing or unreadable
 * snapshot shows a plain "Guest" rather than failing the whole page. */
function storedGuestProfile(json: string | null): GuestProfile {
  try {
    const parsed = guestProfileSchema.safeParse(JSON.parse(json ?? "null"));
    if (parsed.success) return parsed.data;
  } catch {
    // Unreadable snapshots fall through to the plain label.
  }
  return { name: "Guest", provider: "other" };
}

/** Only the appearance fields of a guest author, for storing with a message. */
export function guestProfileOf(author: GuestProfile): GuestProfile {
  return guestProfileSchema.parse({
    name: author.name,
    provider: author.provider,
    model: author.model,
    image: author.image,
    mark: author.mark,
    operator: author.operator,
  });
}

export function toMessage(row: MessageRow): ConversationMessage {
  return conversationMessageSchema.parse({
    id: row.message_id,
    sequence: row.sequence,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    threadRootId: row.thread_root_id ?? undefined,
    author:
      row.author_kind === "guest"
        ? {
            kind: "guest",
            id: row.author_id,
            ...storedGuestProfile(row.author_profile),
          }
        : { kind: row.author_kind, id: row.author_id },
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
