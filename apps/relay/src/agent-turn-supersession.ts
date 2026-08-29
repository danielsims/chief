import type { DurableTurnRunner } from "@chief/agent-runtime/durable-turn";

import type { AgentJobQueue } from "./agent-job-queue";

interface ConversationJob {
  readonly id: string;
  readonly kind: string;
}

export async function supersedeConversationTurn(input: {
  conversationId: string;
  replacementJobId: string;
  turns: DurableTurnRunner;
  queue: AgentJobQueue;
  loadJob: (jobId: string) => ConversationJob | undefined;
}) {
  const active = await input.turns.active();
  if (active?.conversationId === input.conversationId) {
    const job = input.loadJob(active.jobId);
    if (
      job &&
      job.id !== input.replacementJobId &&
      job.kind === "conversation.message"
    ) {
      await input.turns.cancelActive();
    }
  }
  return (
    input.queue.supersedeConversation(
      input.conversationId,
      input.replacementJobId,
    ).length > 0
  );
}
