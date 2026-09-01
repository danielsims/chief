import type { Principal } from "@chief/relay-contracts";
import {
  conversationIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";

export interface ExternalContinuation {
  conversation_id: string;
  thread_root_id: string | null;
}

export function externalConversationFetch(
  env: Env,
  workspaceId: string,
  conversationId: string,
  request: Request,
  principal: Principal,
  requestId: string,
) {
  return env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${workspaceId}:${conversationId}`),
  ).fetch(
    withTrustedContext(request, {
      principal,
      requestId,
      workspaceId: workspaceIdSchema.parse(workspaceId),
      conversationId: conversationIdSchema.parse(conversationId),
    }),
  );
}

export async function requireExternalThreadRoot(
  env: Env,
  workspaceId: string,
  continuation: ExternalContinuation,
  principal: Principal,
  requestId: string,
) {
  if (!continuation.thread_root_id) return;
  const response = await externalConversationFetch(
    env,
    workspaceId,
    continuation.conversation_id,
    new Request(
      `https://relay.internal/messages/${encodeURIComponent(continuation.thread_root_id)}`,
      { headers: { "x-chief-internal-operation": "message-exists" } },
    ),
    principal,
    requestId,
  );
  const exists = response.ok;
  await releaseInternalResponse(response);
  if (!exists)
    throw new HttpError(
      409,
      "external_thread_root_missing",
      "The issued thread continuation no longer exists.",
    );
}
