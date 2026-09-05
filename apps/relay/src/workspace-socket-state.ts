import type { JsonValue, Principal } from "@chief/relay-contracts";
import {
  conversationIdSchema,
  parseJsonObject,
  principalSchema,
} from "@chief/relay-contracts";

export const MAX_REPLAY_EVENTS_PER_CONNECTION = 1_000;
export const SOCKET_MESSAGE_LIMIT_PER_MINUTE = 30;
export const SUBSCRIPTION_UPDATE_LIMIT_PER_MINUTE = 10;

export interface WorkspaceSocketAttachment {
  principal: Principal;
  conversationIds: string[];
  cursor: number | null;
  subscribed: boolean;
  messageWindowStartedAt: number;
  messageCount: number;
  subscriptionWindowStartedAt: number;
  subscriptionCount: number;
}

type SocketAllowance = "message" | "subscription";

export function consumeSocketAllowance(
  socket: WebSocket,
  kind: SocketAllowance,
): WorkspaceSocketAttachment | null {
  const attachment = workspaceSocketAttachment(socket);
  const now = Date.now();
  const windowKey =
    kind === "message"
      ? "messageWindowStartedAt"
      : "subscriptionWindowStartedAt";
  const countKey = kind === "message" ? "messageCount" : "subscriptionCount";
  const limit =
    kind === "message"
      ? SOCKET_MESSAGE_LIMIT_PER_MINUTE
      : SUBSCRIPTION_UPDATE_LIMIT_PER_MINUTE;
  const expired = now - attachment[windowKey] >= 60_000;
  const count = expired ? 1 : attachment[countKey] + 1;
  if (count > limit) {
    socket.close(1008, "Workspace socket rate limit exceeded");
    return null;
  }
  const next: WorkspaceSocketAttachment = {
    ...attachment,
    [windowKey]: expired ? now : attachment[windowKey],
    [countKey]: count,
  };
  socket.serializeAttachment(next);
  return next;
}

export function workspaceSocketAttachment(
  socket: WebSocket,
): WorkspaceSocketAttachment {
  const value = parseJsonObject(socket.deserializeAttachment());
  if (!value) throw new Error("Workspace socket attachment is invalid.");
  return {
    principal: principalSchema.parse(value.principal),
    conversationIds: Array.isArray(value.conversationIds)
      ? value.conversationIds.map((id) => conversationIdSchema.parse(id))
      : [],
    cursor:
      value.cursor === null ||
      (Number.isInteger(value.cursor) && Number(value.cursor) >= 0)
        ? value.cursor === null
          ? null
          : Number(value.cursor)
        : null,
    subscribed: value.subscribed === true,
    messageWindowStartedAt: validTimestamp(value.messageWindowStartedAt),
    messageCount: validCount(value.messageCount),
    subscriptionWindowStartedAt: validTimestamp(
      value.subscriptionWindowStartedAt,
    ),
    subscriptionCount: validCount(value.subscriptionCount),
  };
}

function validTimestamp(value: JsonValue | undefined) {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : Date.now();
}

function validCount(value: JsonValue | undefined) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

export function workspaceDataCapability(operation: string) {
  if (operation === "data-brand-save") return "brand-profile-write";
  if (operation === "data-prospect-save") return "prospects-write";
  if (operation === "data-projects-list") return "projects.read";
  if (operation === "data-machines-list") return "machines.read";
  if (
    operation === "data-project-create" ||
    operation === "data-project-delete"
  )
    return "projects.write";
  if (
    operation === "data-machine-create" ||
    operation === "data-machine-update" ||
    operation === "data-machine-delete"
  )
    return "machines.write";
  if (operation === "data-file-save" || operation === "data-file-asset-save")
    return "messages.send";
  if (operation === "data-file-update") return "workspace.write";
  return "workspace.read";
}
