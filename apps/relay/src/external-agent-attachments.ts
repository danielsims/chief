import { z } from "zod";

import {
  agentIdSchema,
  attachmentLocation,
  chiefChannelContinuationSchema,
  externalAgentDeliveryCommandSchema,
} from "@chief/relay-contracts";

import type { ExternalAgentInboundHost } from "./external-agent-continuation";
import { getAttachment } from "./attachments";
import { requireChannelToken, sha256 } from "./external-agent-channel-security";
import { externalAgentPrincipal } from "./external-agent-continuation";
import { HttpError, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { externalAgentOutboxFindAttachmentDelivery } from "./queries/external-agent-outbox/find-attachment-delivery";
import { firstRow } from "./workspace-channel-store";

const attachmentRequestSchema = z
  .object({
    deliveryId: z.string().trim().min(8).max(256),
    continuation: chiefChannelContinuationSchema,
    url: z.url(),
  })
  .strict();

/**
 * An image an Eve deployment was sent, read with its channel token and the
 * capability of the delivery that carried it. Only an image on that delivery's
 * message is served, only while the delivery is live, and only while the agent
 * can still see the conversation.
 */
export async function receiveExternalAgentAttachment(
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
  const input = attachmentRequestSchema.parse(await parseJson(request));
  const row = firstRow<{ conversation_id: string; payload_json: string }>(
    externalAgentOutboxFindAttachmentDelivery(
      host.storage,
      agentId,
      await sha256(input.continuation.capability),
    ),
  );
  const delivery = row
    ? externalAgentDeliveryCommandSchema.parse(JSON.parse(row.payload_json))
    : undefined;
  const sent = delivery?.payload.message.attachments?.some(
    (attachment) => attachment.url === input.url,
  );
  const location = attachmentLocation(input.url);
  if (
    !row ||
    !delivery ||
    delivery.payload.deliveryId !== input.deliveryId ||
    !sent ||
    location?.workspaceId !== context.workspaceId ||
    location.conversationId !== row.conversation_id
  )
    throw new HttpError(
      404,
      "attachment_not_found",
      "The attachment was not found.",
    );
  const principal = externalAgentPrincipal(context.workspaceId, agentId);
  host.channels.requirePrincipalMember(principal);
  host.channels.requireAgentCapability(principal, "messages.read");
  host.channels.requireChannelVisible(row.conversation_id, principal);
  return getAttachment(
    host.env,
    `${location.workspaceId}/${location.conversationId}/${location.objectName}`,
  );
}
