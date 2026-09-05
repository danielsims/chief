import { z } from "zod";

import { normalizedChannelMentions } from "@chief/agent-runtime/channel-message-mentions";
import {
  agentIdSchema,
  channelMemberAddCommandSchema,
  conversationMessageSchema,
  externalAgentDeliveryCommandSchema,
} from "@chief/relay-contracts";

import { ExternalAgentChannelService } from "./external-agent-channel";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext, withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import { WorkspaceChannelMembership } from "./workspace-channel-membership";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { refreshMemberDisplayNames } from "./workspace-member-names";
import {
  readScheduleRun,
  scheduleRunIsActive,
} from "./workspace-schedule-runs";

const dispatchMessageSchema = z
  .object({
    message: conversationMessageSchema,
    replyAgentId: agentIdSchema.optional(),
    workflowId: z.string().trim().min(1).max(128).optional(),
    missionId: z.string().trim().min(1).max(100).optional(),
    scheduleRunId: z.string().trim().min(1).max(256).optional(),
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
    missionId,
    scheduleRunId,
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

  // Scheduled handoffs belong to the run coordinator. Agent prose mentioning a
  // coworker must not create a second, competing turn outside that sequence.
  if (context.principal.kind === "agent" && message.threadRootId) {
    const scheduled = storage.sql
      .exec(
        "SELECT id FROM workspace_schedule_runs WHERE json_extract(document_json, '$.threadRootId') = ? LIMIT 1",
        message.threadRootId,
      )
      .toArray()[0];
    if (scheduled) return json({ agentIds: [] });
  }
  const store = new WorkspaceChannelStore(storage, env);
  await refreshMemberDisplayNames(storage, env);
  store.requireWorkspace(context.workspaceId);
  store.requirePrincipalMember(context.principal);
  const channel = store.requireChannelVisible(
    message.conversationId,
    context.principal,
  );
  const people = store
    .channelMemberRows(message.conversationId)
    .flatMap((member) =>
      member.kind === "user"
        ? [{ id: member.principalId, name: member.name }]
        : [],
    );
  const mentions = scheduleRunId
    ? message.mentions
    : normalizedChannelMentions({
        availableAgentIds: store.workspaceAgentIds(),
        people,
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
  let agentIds = eligibleAgentIds(
    store,
    channel,
    mentions,
    replyAgentId,
    context.principal.kind === "agent" ? context.principal.agentId : undefined,
  );
  if (scheduleRunId) {
    const run = readScheduleRun(storage, scheduleRunId)?.run;
    const step = run?.steps.find((step) => step.id === message.id);
    if (
      !run ||
      !step ||
      !scheduleRunIsActive(run) ||
      run.threadRootId !== workflowId ||
      run.schedule.conversationId !== message.conversationId
    )
      throw new HttpError(
        409,
        "schedule_run_stopped",
        "This scheduled step is no longer active.",
      );
    agentIds = [step.agentId];
  }
  const threadRootId = owningThreadRoot(channel.kind, message, mentions);
  const now = new Date().toISOString();
  const externalAgents = new ExternalAgentChannelService(storage, env);

  await Promise.all(
    agentIds.map(async (agentId) => {
      const id = await deterministicUuid(
        `${context.workspaceId}:${message.id}:${agentId}:conversation-message`,
      );
      const deliveredExternally = await externalAgents.enqueue(
        context.workspaceId,
        agentId,
        externalAgentDeliveryCommandSchema.parse({
          commandId: id,
          protocolVersion: 1,
          occurredAt: now,
          payload: {
            deliveryId: id,
            continuation: {
              capability: "placeholder-capability-replaced-by-workspace",
            },
            message: {
              id: message.id,
              body: message.body,
              author: message.author,
              createdAt: message.createdAt,
            },
          },
        }),
        message.conversationId,
        threadRootId,
      );
      if (deliveredExternally) return;
      const command = {
        commandId: id,
        protocolVersion: 1,
        occurredAt: now,
        payload: {
          id,
          agentId,
          kind: scheduleRunId ? "schedule.step" : "conversation.message",
          payload: {
            conversationId: message.conversationId,
            messageId: message.id,
            workflowId,
            ...(scheduleRunId ? { scheduleRunId } : undefined),
            ...(missionId ? { missionId } : undefined),
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
      const accepted = response.ok;
      await releaseInternalResponse(response);
      if (!accepted) {
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
    if (!store.agentIsLive(parsed.data)) continue;
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
