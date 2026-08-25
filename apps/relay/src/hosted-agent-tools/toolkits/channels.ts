import type {
  AgentJob,
  AgentPrincipal,
  JsonObject,
} from "@chief/relay-contracts";
import { OnboardingMessagePacer } from "@chief/agent-runtime/onboarding-message-pacing";
import {
  channelCreateCommandSchema,
  channelMemberAddCommandSchema,
  messagePageSchema,
  parseJsonObject,
} from "@chief/relay-contracts";

import { publishAgentMessage } from "../../agent-message-publisher";
import { HttpError } from "../../http";
import { withTrustedContext } from "../../internal-context";
import {
  agentIds,
  memberReferences,
  optionalString,
  requiredString,
} from "../input";
import { defineHostedAgentTool } from "../tool";

const onboardingMessagePacer = new OnboardingMessagePacer();

async function deterministicId(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

async function responseObject(response: Response, fallback: string) {
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(
      response.status,
      "hosted_tool_failed",
      text || fallback,
    );
  }
  if (!text) return { ok: true };
  const parsed = parseJsonObject(JSON.parse(text));
  if (!parsed) throw new Error("Hosted tool returned invalid JSON.");
  return parsed;
}

export async function workspaceOperation(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  operation: string,
  options: { body?: object; conversationId?: string } = {},
) {
  const url = new URL("https://workspace.internal");
  if (options.conversationId) {
    url.searchParams.set("conversationId", options.conversationId);
  }
  const response = await env.WORKSPACES.get(
    env.WORKSPACES.idFromName(job.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request(url, {
        method: "POST",
        headers: {
          "x-chief-internal-operation": operation,
          ...(options.body
            ? { "content-type": "application/json" }
            : undefined),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : undefined),
      }),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: job.workspaceId,
        ...(options.conversationId
          ? { conversationId: options.conversationId }
          : undefined),
      },
    ),
  );
  return responseObject(response, `Workspace operation ${operation} failed.`);
}

async function listMessages(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  input: JsonObject,
) {
  const conversationId = requiredString(input, "channelId");
  const limit = Math.min(100, Math.max(1, Number(input.limit ?? 50)));
  const stub = env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${job.workspaceId}:${conversationId}`),
  );
  const response = await stub.fetch(
    withTrustedContext(
      new Request(`https://conversation.internal/messages?limit=${limit}`),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: job.workspaceId,
        conversationId,
      },
    ),
  );
  return responseObject(response, "Conversation messages could not be read.");
}

export async function recentConversationMessages(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  conversationId: string,
) {
  const result = await listMessages(env, job, principal, {
    channelId: conversationId,
    limit: 40,
  });
  return messagePageSchema.parse(result).messages;
}

export const hostedChannelTools = [
  defineHostedAgentTool(
    "channels.list",
    async ({ env, job, principal }) =>
      await workspaceOperation(env, job, principal, "channels-list"),
  ),
  defineHostedAgentTool(
    "channels.members.list",
    async ({ env, job, principal }, input) =>
      await workspaceOperation(env, job, principal, "channels-members-list", {
        conversationId: requiredString(input, "channelId"),
      }),
  ),
  defineHostedAgentTool(
    "channels.messages.list",
    async ({ env, job, principal }, input) =>
      await listMessages(env, job, principal, input),
  ),
  defineHostedAgentTool(
    "channels.messages.post",
    async ({ env, job }, input) => {
      const conversationId = requiredString(input, "channelId");
      const idempotencyKey =
        optionalString(input, "idempotencyKey") ??
        `${job.id}:${conversationId}`;
      const threadRootId = optionalString(input, "threadRootId");
      const content = requiredString(input, "content");
      await onboardingMessagePacer.beforePost(job.workspaceId, {
        content,
        idempotencyKey,
      });
      await publishAgentMessage(
        env,
        job,
        {
          conversationId,
          body: content,
          mentions: agentIds(input, "mentions"),
          ...(threadRootId ? { threadRootId } : undefined),
        },
        await deterministicUuid(
          `${job.id}:channels.messages.post:${idempotencyKey}`,
        ),
      );
      return { ok: true, conversationId, threadRootId: threadRootId ?? null };
    },
  ),
  defineHostedAgentTool(
    "channels.create",
    async ({ env, job, principal }, input) => {
      const operationKey = requiredString(input, "operationKey");
      return await workspaceOperation(env, job, principal, "channels-create", {
        body: channelCreateCommandSchema.parse({
          commandId: await deterministicUuid(
            `${job.id}:channels.create:${operationKey}`,
          ),
          protocolVersion: 1,
          occurredAt: new Date().toISOString(),
          payload: {
            conversationId: `channel-${await deterministicId(operationKey)}`,
            name: requiredString(input, "name"),
            isPrivate: input.visibility === "private",
          },
        }),
      });
    },
  ),
  defineHostedAgentTool(
    "channels.members.add",
    async ({ env, job, principal }, input) => {
      const conversationId = requiredString(input, "channelId");
      const members = memberReferences(input);
      return await workspaceOperation(
        env,
        job,
        principal,
        "channels-members-add",
        {
          body: channelMemberAddCommandSchema.parse({
            commandId: await deterministicUuid(
              `${job.id}:channels.members.add:${conversationId}:${members.map((member) => `${member.kind}:${member.principalId}`).join(",")}`,
            ),
            protocolVersion: 1,
            occurredAt: new Date().toISOString(),
            payload: { conversationId, members },
          }),
        },
      );
    },
  ),
];
