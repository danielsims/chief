import type { JsonObject } from "@chief/relay-contracts";
import {
  upsertAgentActivityPayloadSchema,
  upsertAgentActivityResultSchema,
} from "@chief/relay-contracts";

import type { SqlConversationStore } from "./conversation-store";
import type { readTrustedContext } from "./internal-context";
import { recordRelayActivity } from "./activity-diagnostics";
import { HttpError, json, parseJson } from "./http";
import { requiredTrustedConversationId } from "./internal-context";

interface ConversationActivityInput {
  request: Request;
  context: ReturnType<typeof readTrustedContext>;
  messageId: string;
  store: SqlConversationStore;
  broadcast: (event: JsonObject) => void;
  publishWorkspaceEvent: (
    event: JsonObject,
    context: ReturnType<typeof readTrustedContext>,
  ) => void;
}

export async function upsertConversationActivity(
  input: ConversationActivityInput,
) {
  const { context } = input;
  if (context.principal.kind !== "agent") {
    throw new HttpError(
      403,
      "agent_principal_required",
      "Only an agent cell may publish agent activity.",
    );
  }
  const payload = upsertAgentActivityPayloadSchema.parse(
    await parseJson(input.request),
  );
  const conversationId = requiredTrustedConversationId(context);
  if (
    payload.messageId !== input.messageId ||
    payload.conversationId !== conversationId
  ) {
    throw new HttpError(
      409,
      "activity_scope_mismatch",
      "The activity does not match the routed conversation.",
    );
  }
  const result = input.store.upsertActivity({
    ...payload,
    actor: context.principal,
    workspaceId: context.workspaceId,
    correlationId: context.requestId,
  });
  const diagnostic = {
    workspaceId: context.workspaceId,
    conversationId,
    threadRootId: payload.threadRootId,
    agentId: context.principal.agentId,
    requestId: context.requestId,
    messageId: payload.messageId,
    component: payload.component,
  };
  recordRelayActivity("persisted", diagnostic, result);
  input.broadcast(result.event);
  input.publishWorkspaceEvent(result.event, context);
  recordRelayActivity("broadcast", diagnostic, result);
  return json(
    upsertAgentActivityResultSchema.parse({
      created: result.created,
      message: result.message,
    }),
  );
}
