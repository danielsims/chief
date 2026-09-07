import {
  appendMessageCommandSchema,
  appendMessageResultSchema,
  externalAgentDeliveryCommandSchema,
  externalAgentInboundActivityResultSchema,
  externalAgentInboundActivitySchema,
  externalAgentInboundMessageSchema,
  externalAgentInboundResultSchema,
} from "@chief/relay-contracts";

import type { ExternalAgentInboundHost } from "./external-agent-continuation";
import { dispatchAppendedMessage } from "./conversation-agent-dispatch";
import { deterministicUuid, sha256 } from "./external-agent-channel-security";
import { resolveExternalContinuation } from "./external-agent-continuation";
import {
  externalConversationFetch,
  requireExternalThreadRoot,
} from "./external-agent-conversation";
import { HttpError, json, parseJson } from "./http";
import { releaseInternalResponse } from "./internal-response";
import { externalAgentInboundReceiptsFindReceiveExternalAgentMessage } from "./queries/external-agent-inbound-receipts/find-receive-external-agent-message";
import { externalAgentInboundReceiptsInsertReceiveExternalAgentMessage } from "./queries/external-agent-inbound-receipts/insert-receive-external-agent-message";
import { externalAgentInboundReceiptsUpdateReceiveExternalAgentMessage } from "./queries/external-agent-inbound-receipts/update-receive-external-agent-message";
import { workspaceScheduleRunsFindReceiveExternalAgentMessage } from "./queries/workspace-schedule-runs/find-receive-external-agent-message";
import { firstRow } from "./workspace-channel-store";
import {
  finishScheduleRun,
  readScheduleRun,
  scheduleRunIsActive,
  writeScheduleRun,
} from "./workspace-schedule-runs";
import { wakeWorkspaceSchedules } from "./workspace-schedule-store";

interface ReceiptRow extends Record<string, SqlStorageValue> {
  payload_hash: string;
  message_id: string;
  status: "claimed" | "accepted";
}

export type { ExternalAgentInboundHost } from "./external-agent-continuation";

export async function receiveExternalAgentMessage(
  host: ExternalAgentInboundHost,
  request: Request,
  rawAgentId: string,
) {
  const input = externalAgentInboundMessageSchema.parse(
    await parseJson(request),
  );
  const { context, agentId, principal, continuation } =
    await resolveExternalContinuation(
      host,
      request,
      rawAgentId,
      input,
      !input.publish && input.complete,
    );
  const payloadHash = await sha256(JSON.stringify(input));
  const messageId = await deterministicUuid(
    `${context.workspaceId}:${agentId}:external:${input.deliveryId}`,
  );
  const receipt = firstRow<ReceiptRow>(
    externalAgentInboundReceiptsFindReceiveExternalAgentMessage(
      host.storage,
      agentId,
      input.deliveryId,
    ),
  );
  if (receipt && receipt.payload_hash !== payloadHash)
    throw new HttpError(
      409,
      "external_delivery_conflict",
      "This delivery id was already used with different content.",
    );
  if (receipt?.status === "accepted")
    return json(
      externalAgentInboundResultSchema.parse({
        duplicate: true,
        messageId: receipt.message_id,
      }),
    );
  const now = new Date().toISOString();
  if (!receipt)
    externalAgentInboundReceiptsInsertReceiveExternalAgentMessage(
      host.storage,
      {
        agentId: agentId,
        deliveryId: input.deliveryId,
        payloadHash: payloadHash,
        messageId: messageId,
        createdAt: now,
        updatedAt: now,
      },
    );
  host.channels.requirePrincipalMember(principal);
  host.channels.requireAgentCapability(principal, "messages.send");
  host.channels.requireChannelVisible(continuation.conversation_id, principal);
  await requireExternalThreadRoot(
    host.env,
    context.workspaceId,
    continuation,
    principal,
    context.requestId,
  );
  let duplicate = false;
  if (input.publish) {
    const command = appendMessageCommandSchema.parse({
      commandId: messageId,
      protocolVersion: 1,
      occurredAt: now,
      payload: {
        messageId,
        conversationId: continuation.conversation_id,
        threadRootId: continuation.thread_root_id ?? undefined,
        body: input.body,
        mentions: [],
        components: [],
      },
    });
    const appendRequest = new Request("https://relay.internal/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    const response = await externalConversationFetch(
      host.env,
      context.workspaceId,
      continuation.conversation_id,
      appendRequest,
      principal,
      context.requestId,
    );
    if (!response.ok) return response;
    const result = appendMessageResultSchema.parse(
      await response.clone().json(),
    );
    const dispatched = await dispatchAppendedMessage(host.env, {
      request: appendRequest,
      response,
      principal,
      requestId: context.requestId,
      workspaceId: context.workspaceId,
      conversationId: continuation.conversation_id,
    });
    if (!dispatched.ok) return dispatched;
    await releaseInternalResponse(dispatched);
    duplicate = result.duplicate;
  }
  // The final reply is durable before a scheduled teammate receives its turn.
  if (input.complete && continuation.thread_root_id) {
    const row = workspaceScheduleRunsFindReceiveExternalAgentMessage<{
      id: string;
    }>(host.storage, continuation.thread_root_id)[0];
    const current = row ? readScheduleRun(host.storage, row.id) : null;
    const delivery = externalAgentDeliveryCommandSchema.parse(
      JSON.parse(continuation.payload_json),
    );
    const step = current?.run.steps.find(
      (step) =>
        step.id ===
          (delivery.payload.scheduleStepId ?? delivery.payload.message.id) &&
        step.agentId === agentId,
    );
    if (
      current &&
      step &&
      scheduleRunIsActive(current.run) &&
      ["pending", "running"].includes(step.state)
    ) {
      if (input.outcome === "failed") {
        finishScheduleRun(
          host.storage,
          current.run.id,
          "failed",
          input.body || "The agent turn failed.",
        );
      } else {
        step.state = "completed";
        step.completedAt = Date.now();
        step.evidence ??= input.body.slice(0, 4000);
        current.run.summary = step.evidence;
        current.run.nextCheckAt = Date.now();
        writeScheduleRun(host.storage, current.run, current.principal);
      }
      await wakeWorkspaceSchedules(host.storage);
    }
  }
  externalAgentInboundReceiptsUpdateReceiveExternalAgentMessage(host.storage, {
    updatedAt: new Date().toISOString(),
    agentId: agentId,
    deliveryId: input.deliveryId,
  });
  return json(
    externalAgentInboundResultSchema.parse({
      duplicate,
      messageId,
    }),
  );
}

export async function receiveExternalAgentActivity(
  host: ExternalAgentInboundHost,
  request: Request,
  rawAgentId: string,
) {
  const input = externalAgentInboundActivitySchema.parse(
    await parseJson(request),
  );
  const { context, agentId, principal, continuation } =
    await resolveExternalContinuation(host, request, rawAgentId, input);
  host.channels.requirePrincipalMember(principal);
  host.channels.requireAgentCapability(principal, "messages.send");
  host.channels.requireChannelVisible(continuation.conversation_id, principal);
  await requireExternalThreadRoot(
    host.env,
    context.workspaceId,
    continuation,
    principal,
    context.requestId,
  );
  const messageId = await deterministicUuid(
    `${context.workspaceId}:${agentId}:external:${input.deliveryId}:activity:${input.component.id}`,
  );
  const response = await externalConversationFetch(
    host.env,
    context.workspaceId,
    continuation.conversation_id,
    new Request(
      `https://relay.internal/messages/${encodeURIComponent(messageId)}/activity`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messageId,
          conversationId: continuation.conversation_id,
          ...(continuation.thread_root_id
            ? { threadRootId: continuation.thread_root_id }
            : undefined),
          component: input.component,
        }),
      },
    ),
    principal,
    context.requestId,
  );
  if (!response.ok) return response;
  await releaseInternalResponse(response);
  return json(externalAgentInboundActivityResultSchema.parse({ messageId }));
}
