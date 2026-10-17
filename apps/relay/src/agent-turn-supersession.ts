import type { DurableTurnRunner } from "@chief/agent-runtime/durable-turn";
import type { JsonValue } from "@chief/relay-contracts";

import type { AgentJobQueue } from "./agent-job-queue";

/**
 * The conversation work a new message or a Stop replaces. A thread is its own
 * session, so a message only replaces work in its own thread; Stop replaces
 * everything in the conversation.
 */
export interface ConversationScope {
  conversationId: string;
  threadRootId?: string;
  allThreads?: boolean;
}

export function inConversationScope(
  scope: ConversationScope,
  conversationId: JsonValue | undefined,
  threadRootId: JsonValue | undefined,
) {
  return (
    conversationId === scope.conversationId &&
    (scope.allThreads === true || threadRootId === scope.threadRootId)
  );
}

interface ConversationJob {
  readonly id: string;
  readonly kind: string;
}

export async function supersedeConversationTurn(input: {
  scope: ConversationScope;
  replacementJobId?: string;
  turns: DurableTurnRunner;
  queue: AgentJobQueue;
  loadJob: (jobId: string) => ConversationJob | undefined;
}) {
  const active = await input.turns.active();
  let cancelledHostedTurn = false;
  if (
    active &&
    inConversationScope(input.scope, active.conversationId, active.threadRootId)
  ) {
    const job = input.loadJob(active.jobId);
    if (
      job &&
      job.id !== input.replacementJobId &&
      job.kind === "conversation.message"
    ) {
      await input.turns.cancelActive();
      cancelledHostedTurn = true;
    }
  }
  // A new message steers a run already going on a device rather than
  // replacing it; only Stop, or a hosted turn just cancelled, ends it.
  const superseded = await input.queue.supersedeConversation(
    input.scope,
    input.replacementJobId,
    input.replacementJobId !== undefined && !cancelledHostedTurn,
  );
  return superseded.length > 0;
}
