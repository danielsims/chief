export interface ActiveAgentSessionIdentity {
  chatId: string;
  agentId: string;
  threadRootId?: string;
}

/**
 * A workspace gateway cannot prove the concurrent caller; only an agent-bound capability may select a live session.
 */
export function resolveActiveAgentSession(
  busy: readonly ActiveAgentSessionIdentity[],
  requestedSessionId?: string,
  requestedSessionIsCredentialBound = false,
): ActiveAgentSessionIdentity | undefined {
  if (requestedSessionIsCredentialBound && requestedSessionId) {
    return busy.find((candidate) => candidate.chatId === requestedSessionId);
  }
  return busy.length === 1 ? busy[0] : undefined;
}

export function workspaceChatKey(workspaceId: string, chatId: string) {
  return `${workspaceId}\0${chatId}`;
}
