import {
  agentIdSchema,
  appendMessageCommandSchema,
  appendMessageResultSchema,
  externalAgentInboundActivityResultSchema,
  externalAgentInboundActivitySchema,
  externalAgentInboundMessageSchema,
  externalAgentInboundResultSchema,
} from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { dispatchAppendedMessage } from "./conversation-agent-dispatch";
import {
  deterministicUuid,
  requireChannelToken,
  sha256,
} from "./external-agent-channel-security";
import {
  externalConversationFetch,
  requireExternalThreadRoot,
} from "./external-agent-conversation";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import { firstRow } from "./workspace-channel-store";

interface ContinuationRow extends Record<string, SqlStorageValue> {
  conversation_id: string;
  thread_root_id: string | null;
  session_id: string;
}
interface ReceiptRow extends Record<string, SqlStorageValue> {
  payload_hash: string;
  message_id: string;
  status: "claimed" | "accepted";
}

const EXTERNAL_AGENT_PUBKEY = "0".repeat(64);

export interface ExternalAgentInboundHost {
  storage: DurableObjectStorage;
  env: Env;
  channels: WorkspaceChannelStore;
  runtime: (agentId: string) => { token_hash: string } | undefined;
}

export async function receiveExternalAgentMessage(
  host: ExternalAgentInboundHost,
  request: Request,
  rawAgentId: string,
) {
  const context = readTrustedContext(request);
  const agentId = agentIdSchema.parse(rawAgentId);
  const runtime = host.runtime(agentId);
  if (!runtime)
    throw new HttpError(
      404,
      "external_agent_not_found",
      "This external agent is not registered.",
    );
  await requireChannelToken(request, runtime.token_hash);
  const input = externalAgentInboundMessageSchema.parse(
    await parseJson(request),
  );
  const continuation = firstRow<ContinuationRow>(
    host.storage.sql.exec(
      `SELECT conversation_id, thread_root_id, session_id FROM external_agent_outbox WHERE agent_id = ? AND capability_hash = ? AND status = 'accepted'`,
      agentId,
      await sha256(input.continuation.capability),
    ),
  );
  if (!continuation || continuation.session_id !== input.sessionId)
    throw new HttpError(
      403,
      "external_continuation_invalid",
      "This continuation was not issued to this agent session.",
    );
  const payloadHash = await sha256(JSON.stringify(input));
  const messageId = await deterministicUuid(
    `${context.workspaceId}:${agentId}:external:${input.deliveryId}`,
  );
  const receipt = firstRow<ReceiptRow>(
    host.storage.sql.exec(
      "SELECT * FROM external_agent_inbound_receipts WHERE agent_id = ? AND delivery_id = ?",
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
    host.storage.sql.exec(
      `INSERT INTO external_agent_inbound_receipts (agent_id, delivery_id, payload_hash, message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'claimed', ?, ?)`,
      agentId,
      input.deliveryId,
      payloadHash,
      messageId,
      now,
      now,
    );
  const principal = {
    kind: "agent" as const,
    agentId,
    pubkey: EXTERNAL_AGENT_PUBKEY,
    workspaceId: context.workspaceId,
    role: "member" as const,
  };
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
  const result = appendMessageResultSchema.parse(await response.clone().json());
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
  host.storage.sql.exec(
    "UPDATE external_agent_inbound_receipts SET status = 'accepted', updated_at = ? WHERE agent_id = ? AND delivery_id = ?",
    new Date().toISOString(),
    agentId,
    input.deliveryId,
  );
  return json(
    externalAgentInboundResultSchema.parse({
      duplicate: result.duplicate,
      messageId: result.message.id,
    }),
  );
}

export async function receiveExternalAgentActivity(
  host: ExternalAgentInboundHost,
  request: Request,
  rawAgentId: string,
) {
  const context = readTrustedContext(request);
  const agentId = agentIdSchema.parse(rawAgentId);
  const runtime = host.runtime(agentId);
  if (!runtime)
    throw new HttpError(
      404,
      "external_agent_not_found",
      "This external agent is not registered.",
    );
  await requireChannelToken(request, runtime.token_hash);
  const input = externalAgentInboundActivitySchema.parse(
    await parseJson(request),
  );
  const continuation = firstRow<ContinuationRow>(
    host.storage.sql.exec(
      `SELECT conversation_id, thread_root_id, session_id FROM external_agent_outbox WHERE agent_id = ? AND capability_hash = ? AND status = 'accepted'`,
      agentId,
      await sha256(input.continuation.capability),
    ),
  );
  if (!continuation || continuation.session_id !== input.sessionId)
    throw new HttpError(
      403,
      "external_continuation_invalid",
      "This continuation was not issued to this agent session.",
    );
  const messageId = await deterministicUuid(
    `${context.workspaceId}:${agentId}:external:${input.deliveryId}:activity:${input.component.id}`,
  );
  const principal = {
    kind: "agent" as const,
    agentId,
    pubkey: EXTERNAL_AGENT_PUBKEY,
    workspaceId: context.workspaceId,
    role: "member" as const,
  };
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
