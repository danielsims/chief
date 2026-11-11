import type { Principal } from "@chief/relay-contracts";
import {
  conversationIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { HttpError } from "./http";

export function principalKindId(principal: Principal) {
  if (principal.kind === "user")
    return { kind: "user" as const, id: principal.userId };
  if (principal.kind === "agent")
    return { kind: "agent" as const, id: principal.agentId };
  return { kind: "service" as const, id: principal.service };
}

export function channelRecordFromRow(row: {
  conversation_id: string;
  workspace_id: string;
  name: string;
  is_private: number;
  archived: number;
  created_at: string;
}) {
  return {
    id: conversationIdSchema.parse(String(row.conversation_id)),
    workspaceId: workspaceIdSchema.parse(String(row.workspace_id)),
    name: String(row.name),
    isPrivate: Number(row.is_private) === 1,
    archived: Number(row.archived) === 1,
    createdAt: String(row.created_at),
  };
}

export function parseChannelId(value: string | null) {
  if (value === null) {
    throw new HttpError(
      400,
      "missing_conversation",
      "A conversationId query parameter is required.",
    );
  }
  return conversationIdSchema.parse(decodeURIComponent(value));
}

export function firstRow<T>(cursor: Iterable<T>): T | undefined {
  const next = cursor[Symbol.iterator]().next();
  return next.done ? undefined : next.value;
}
