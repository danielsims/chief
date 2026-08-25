import { z } from "zod";

import type { AgentPrincipal } from "@chief/relay-contracts";
import {
  agentIdSchema,
  conversationMessageSchema,
  pluginActionPayloadSchema,
} from "@chief/relay-contracts";

import { publishAgentErrorActivity } from "./agent-activity-error";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext, withTrustedContext } from "./internal-context";
import { WorkspaceChannelStore } from "./workspace-channel-store";

const dispatchMessageSchema = z
  .object({
    message: conversationMessageSchema,
    replyAgentId: agentIdSchema.optional(),
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
  if (context.principal.kind !== "user") {
    return json({ agentIds: [] });
  }

  const { message, replyAgentId } = dispatchMessageSchema.parse(
    await parseJson(request),
  );
  if (
    message.workspaceId !== context.workspaceId ||
    message.conversationId !== context.conversationId ||
    message.author.kind !== "user" ||
    message.author.id !== context.principal.userId
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
  const dispatch = eligibleAgentIds(
    store,
    channel,
    message.mentions,
    replyAgentId,
  );
  const now = new Date().toISOString();

  await Promise.all(
    dispatch.ready.map(async (agentId) => {
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
            ...(message.threadRootId
              ? { threadRootId: message.threadRootId }
              : undefined),
            mentions: message.mentions,
            instruction: dispatchedInstruction(message, agentId),
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
            headers: { "content-type": "application/json" },
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

  await Promise.all(
    dispatch.providerRequired.map(async (agentId) => {
      const pubkey = store.agentPubkey(agentId);
      if (!pubkey) return;
      const principal: AgentPrincipal = {
        kind: "agent",
        agentId: agentIdSchema.parse(agentId),
        pubkey,
        workspaceId: message.workspaceId,
        role: "member",
      };
      await publishAgentErrorActivity(env, {
        principal,
        conversationId: message.conversationId,
        ...(message.threadRootId
          ? { threadRootId: message.threadRootId }
          : undefined),
        seed: `${context.workspaceId}:${message.id}:${agentId}:provider-required`,
        code: "agent_provider_required",
        title: "Agent provider required",
        message:
          "Choose an agent provider and model before this agent can respond.",
      });
    }),
  );

  return json({ agentIds: dispatch.ready });
}

function dispatchedInstruction(
  message: z.infer<typeof conversationMessageSchema>,
  agentId: string,
) {
  const action = message.components.flatMap((component) => {
    if (component.kind !== "plugin.action") return [];
    const parsed = pluginActionPayloadSchema.safeParse(component.payload);
    return parsed.success && parsed.data.targetAgentId === agentId
      ? [parsed.data]
      : [];
  })[0];
  if (!action) return message.body;
  const placement = `conversationId ${action.conversationId}${action.threadRootId ? ` and threadRootId ${action.threadRootId}` : ""}`;
  if (action.action === "uninstall") {
    return `The user explicitly approved disconnecting ${action.pluginName}. Call plugins_uninstall with pluginId ${action.pluginId}, then call plugins_recommend in ${placement} with pluginIds [${action.pluginId}] and idempotencyKey ${message.id}-plugin-status. Do not claim success without the tool results.`;
  }
  if (action.action === "authorize") {
    return `The user explicitly approved authorizing ${action.pluginName}. Call plugins_authorize with pluginId ${action.pluginId}, ${placement}, and idempotencyKey ${message.id}-plugin-authorization. If it connects immediately, call plugins_recommend in the same placement with pluginIds [${action.pluginId}] and idempotencyKey ${message.id}-plugin-status. The durable authorization card is the only acceptable sign-in handoff.`;
  }
  return `The user explicitly approved installing and authorizing ${action.pluginName}. Call plugins_install with pluginId ${action.pluginId} and trusted true. Then call plugins_authorize with the same pluginId, ${placement}, and idempotencyKey ${message.id}-plugin-authorization. If it connects immediately, call plugins_recommend in the same placement with pluginIds [${action.pluginId}] and idempotencyKey ${message.id}-plugin-status. Do not claim success without the tool results.`;
}

function eligibleAgentIds(
  store: WorkspaceChannelStore,
  channel: ReturnType<WorkspaceChannelStore["requireChannel"]>,
  mentions: readonly string[],
  replyAgentId?: string,
) {
  const candidates =
    channel.kind === "direct"
      ? store
          .channelMemberRows(String(channel.conversation_id))
          .filter((member) => member.kind === "agent")
          .map((member) => member.principalId)
      : [...mentions, ...(replyAgentId ? [replyAgentId] : [])];
  const ready: string[] = [];
  const providerRequired: string[] = [];
  for (const value of new Set(candidates)) {
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
    if (!config.providerAssigned) providerRequired.push(parsed.data);
    else ready.push(parsed.data);
  }
  return { providerRequired, ready };
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
