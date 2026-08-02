import type { MessageAttachment } from "@chief/agent-runtime/types";

export interface ComposerHandoff {
  text: string;
  attachments: readonly MessageAttachment[];
}

const handoffs = new Map<string, ComposerHandoff>();
const MAX_PENDING_HANDOFFS = 8;

export function createComposerHandoff(handoff: ComposerHandoff) {
  const id = crypto.randomUUID();
  handoffs.set(id, handoff);
  if (handoffs.size > MAX_PENDING_HANDOFFS) {
    const oldestId = handoffs.keys().next().value;
    if (oldestId) handoffs.delete(oldestId);
  }
  return id;
}

export function composerHandoff(id: string | null) {
  return id ? handoffs.get(id) : undefined;
}

export function clearComposerHandoff(id: string | null) {
  if (id) handoffs.delete(id);
}
