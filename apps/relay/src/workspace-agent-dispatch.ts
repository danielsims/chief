import { z } from "zod";

import { normalizedChannelMentions } from "@chief/agent-runtime/channel-message-mentions";
import {
  agentIdSchema,
  channelMemberAddCommandSchema,
  conversationMessageSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext, withTrustedContext } from "./internal-context";
import { WorkspaceChannelMembership } from "./workspace-channel-membership";
import { WorkspaceChannelStore } from "./workspace-channel-store";

const dispatchMessageSchema = z
  .object({
    message: conversationMessageSchema,
    replyAgentId: agentIdSchema.optional(),
    workflowId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

/**
 * Resolves agent recipients from workspace-owned membership state and queues
 * one idempotent cell job for each eligible recipient.
 */
export async function dispatchWorkspaceMessage(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  const context = readTrustedContext(request);
  if (context.principal.kind === "service") {
    return json({ agentIds: [] });
  }

  const {
    message,
    replyAgentId,
    workflowId = message.id,
  } = dispatchMessageSchema.parse(await parseJson(request));
  const authorMatchesPrincipal =
    (context.principal.kind === "user" &&
      message.author.kind === "user" &&
      message.author.id === context.principal.userId) ||
    (context.principal.kind === "agent" &&
      message.author.kind === "agent" &&
      message.author.id === context.principal.agentId);
  if (
    message.workspaceId !== context.workspaceId ||
    message.conversationId !== context.conversationId ||
    !authorMatchesPrincipal
  ) {
    throw new HttpError(
      409,
      "message_dispatch_scope_mismatch",
      "The agent dispatch does not match its trusted relay scope.",
    );
  }

  const store = new WorkspaceChannelStore(storage, env);
  store.requireWorkspace(context.workspaceId);
  store.requirePrincipalMember(context.principal);
  const channel = store.requireChannelVisible(
    message.conversationId,
    context.principal,
  );
  const mentions = normalizedChannelMentions({
    availableAgentIds: store.workspaceAgentIds(),
    content: message.body,
    explicitMentions: message.mentions,
  });
  await addMentionedAgentsToChannel({
    context,
    conversationId: message.conversationId,
    mentions,
    messageId: message.id,
    store,
  });
  const agentIds = eligibleAgentIds(
    store,
    channel,
    mentions,
    replyAgentId,
    context.principal.kind === "agent" ? context.principal.agentId : undefined,
  );
  const threadRootId = owningThreadRoot(channel.kind, message, mentions);
  const now = new Date().toISOString();

  await Promise.all(
    agentIds.map(async (agentId) => {
      const id = await deterministicUuid(
        `${context.workspaceId}:${message.id}:${agentId}:conversation-message`,
      );
      const command = {
        commandId: id,
        protocolVersion: 1,
        occurredAt: now,
        payload: {
          id,
          agentId,
          kind: "conversation.message",
          payload: {
            conversationId: message.conversationId,
            messageId: message.id,
            workflowId,
            ...(threadRootId ? { threadRootId } : undefined),
            mentions,
            instruction: dispatchedInstruction(message),
          },
          availableAt: now,
        },
      };
      const stub = env.AGENTS.get(
        env.AGENTS.idFromName(`${context.workspaceId}:${agentId}`),
      );
      const response = await stub.fetch(
        withTrustedContext(
          new Request("https://agent.internal/enqueue", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-chief-workflow-id": workflowId,
            },
            body: JSON.stringify(command),
          }),
          {
            principal: context.principal,
            requestId: context.requestId,
            workspaceId: context.workspaceId,
          },
        ),
      );
      if (!response.ok) {
        throw new HttpError(
          502,
          "agent_enqueue_failed",
          "The addressed agent could not be queued.",
        );
      }
    }),
  );

  return json({ agentIds });
}

async function addMentionedAgentsToChannel(input: {
  context: ReturnType<typeof readTrustedContext>;
  conversationId: string;
  mentions: readonly string[];
  messageId: string;
  store: WorkspaceChannelStore;
}) {
  const missing = input.mentions.filter(
    (agentId) =>
      input.store.memberRole("agent", agentId) &&
      !input.store.channelMembership(input.conversationId, "agent", agentId),
  );
  if (missing.length === 0) return;
  const commandId = await deterministicUuid(
    `${input.context.workspaceId}:${input.messageId}:mention-membership`,
  );
  const command = channelMemberAddCommandSchema.parse({
    commandId,
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      conversationId: input.conversationId,
      members: missing.map((principalId) => ({
        kind: "agent" as const,
        principalId,
      })),
    },
  });
  await new WorkspaceChannelMembership(input.store).channelsMembersAdd(
    new Request("https://workspace.internal/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    }),
    input.context,
    true,
  );
}

function owningThreadRoot(
  channelKind: "channel" | "direct",
  message: z.infer<typeof conversationMessageSchema>,
  mentions: readonly string[],
) {
  if (message.threadRootId) return message.threadRootId;
  if (channelKind === "channel" && mentions.length > 0) return message.id;
  return undefined;
}

function dispatchedInstruction(
  message: z.infer<typeof conversationMessageSchema>,
) {
  return message.body;
}

function eligibleAgentIds(
  store: WorkspaceChannelStore,
  channel: ReturnType<WorkspaceChannelStore["requireChannel"]>,
  mentions: readonly string[],
  replyAgentId?: string,
  sourceAgentId?: string,
) {
  const candidates =
    channel.kind === "direct"
      ? store
          .channelMemberRows(String(channel.conversation_id))
          .filter((member) => member.kind === "agent")
          .map((member) => member.principalId)
      : [...mentions, ...(replyAgentId ? [replyAgentId] : [])];
  const ready: string[] = [];
  for (const value of new Set(candidates)) {
    if (value === sourceAgentId) continue;
    const parsed = agentIdSchema.safeParse(value);
    if (!parsed.success || !store.memberRole("agent", parsed.data)) continue;
    if (
      Number(channel.is_private) === 1 &&
      !store.channelMembership(
        String(channel.conversation_id),
        "agent",
        parsed.data,
      )
    ) {
      continue;
    }
    const config = store.agentConfiguration(parsed.data);
    if (!config.enabled) continue;
    ready.push(parsed.data);
  }
  return ready;
}

async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
