import { messageMentionsPerson } from "@chief/agent-runtime/channel-message-mentions";
import type {
  ConversationMessage,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  channelMembersResultSchema,
  conversationEventSchema,
  isJsonString,
} from "@chief/relay-contracts";

import { sendApnsAlert } from "./apns-client";
import { withTrustedAccountIdentity, withTrustedContext } from "./internal-context";
import { accountStub, workspaceStub } from "./workspace-stubs";

const activityComponentKinds = new Set([
  "agent.activity",
  "thinking",
  "tool",
  "error",
  "browser",
]);

export async function notifyConversationPush(
  env: Env,
  event: unknown,
  principal: Principal,
  workspaceId: WorkspaceId,
  conversationId: string,
  requestId: string,
) {
  const parsed = conversationEventSchema.safeParse(event);
  if (!parsed.success || parsed.data.type !== "conversation.message.appended") {
    return;
  }
  const message = parsed.data.payload.message;
  if (!shouldNotify(message)) return;
  const members = await conversationPeople(
    env,
    principal,
    workspaceId,
    conversationId,
    requestId,
  );
  const authorId =
    message.author.kind === "user" ? message.author.id : undefined;
  const body = message.body.trim() || "Sent an attachment";
  await Promise.all(
    conversationPushAlerts(message, members)
      .filter((alert) => alert.userId !== authorId)
      .map((alert) =>
        notifyUser(env, alert.userId, {
          title: alert.title,
          body,
          workspaceId,
          conversationId,
          threadRootId: message.threadRootId,
          mentioned: alert.mentioned,
        }),
      ),
  );
}

export function conversationPushAlerts(
  message: ConversationMessage,
  people: readonly { id: string; name?: string }[],
) {
  const mentionedIds = new Set(
    people
      .filter((person) =>
        messageMentionsPerson({
          content: message.body,
          mentions: message.mentions,
          person,
        }),
      )
      .map((person) => person.id),
  );
  const recipients = new Set(people.map((person) => person.id));
  for (const userId of mentionedIds) recipients.add(userId);
  return [...recipients].map((userId) => {
    const mentioned = mentionedIds.has(userId);
    return {
      userId,
      mentioned,
      title: mentioned ? mentionPushTitle(message) : pushTitle(message),
    };
  });
}

function shouldNotify(message: ConversationMessage) {
  if (message.deleted) return false;
  if (message.body.trim()) return true;
  if (message.components.length === 0) return false;
  return !message.components.every((component) =>
    activityComponentKinds.has(component.kind),
  );
}

function authorDisplayName(message: ConversationMessage) {
  if (message.author.kind !== "agent") return "Someone";
  if (message.author.id === "chief") return "Chief";
  if (message.author.id === "brand") return "Marketer";
  return `${message.author.id.charAt(0).toUpperCase()}${message.author.id.slice(1)}`;
}

function mentionPushTitle(message: ConversationMessage) {
  const name = authorDisplayName(message);
  const channel = message.conversationId;
  if (/^[a-z0-9][a-z0-9-]{0,39}$/iu.test(channel)) {
    return `${name} mentioned you in #${channel}`;
  }
  return `${name} mentioned you`;
}

function pushTitle(message: ConversationMessage) {
  const name = authorDisplayName(message);
  const channel = message.conversationId;
  if (/^[a-z0-9][a-z0-9-]{0,39}$/iu.test(channel)) {
    return `${name} in #${channel}`;
  }
  return name;
}

async function conversationPeople(
  env: Env,
  principal: Principal,
  workspaceId: WorkspaceId,
  conversationId: string,
  requestId: string,
) {
  const url = new URL("https://workspace.internal");
  url.searchParams.set("conversationId", conversationId);
  const response = await workspaceStub(env, workspaceId).fetch(
    withTrustedContext(
      new Request(url, {
        method: "POST",
        headers: { "x-chief-internal-operation": "channels-members-list" },
      }),
      { principal, requestId, workspaceId, conversationId },
    ),
  );
  if (!response.ok) {
    await response.text();
    return [];
  }
  const parsed = channelMembersResultSchema.safeParse(await response.json());
  if (!parsed.success) return [];
  return parsed.data.members
    .filter((member) => member.kind === "user")
    .map((member) => ({ id: member.principalId, name: member.name }));
}

async function notifyUser(
  env: Env,
  userId: string,
  payload: {
    title: string;
    body: string;
    workspaceId: string;
    conversationId: string;
    threadRootId?: string;
    mentioned?: boolean;
  },
) {
  const response = await accountStub(env, userId).fetch(
    withTrustedAccountIdentity(
      { kind: "service", service: "apns" },
      {
        method: "POST",
        headers: { "x-chief-internal-operation": "list-push-devices" },
      },
    ),
  );
  if (!response.ok) {
    await response.text();
    return;
  }
  const document: unknown = await response.json();
  const devices = Array.isArray((document as { devices?: unknown }).devices)
    ? (document as { devices: { token: unknown; environment: unknown }[] })
        .devices
    : [];
  await Promise.all(
    devices.map(async (device) => {
      if (!isJsonString(device.token) || !isJsonString(device.environment)) {
        return;
      }
      const environment =
        device.environment === "production" ? "production" : "sandbox";
      const status = await sendApnsAlert(env, {
        token: device.token,
        environment,
        title: payload.title,
        body: payload.body,
        workspaceId: payload.workspaceId,
        conversationId: payload.conversationId,
        threadRootId: payload.threadRootId,
        mentioned: payload.mentioned,
      });
      if (status === 410) {
        await accountStub(env, userId).fetch(
          withTrustedAccountIdentity(
            { kind: "service", service: "apns" },
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-chief-internal-operation": "delete-push-device",
              },
              body: JSON.stringify({ token: device.token }),
            },
          ),
        );
      }
    }),
  );
}
