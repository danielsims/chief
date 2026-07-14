/** New chats are persisted by the workspace-scoped runtime after first use. */

export interface ChatLogEntry {
  id: string;
  agentId: string;
  title: string;
  /** Last message the user sent, shown as the row preview. */
  lastText: string;
  lastAt: number;
  driver?: import("@chief/agent-runtime/types").DriverType;
  model?: string;
}

const KEY = "chief-chat-log";

/** Remove the retired browser-global index after the libSQL migration. */
export function clearLegacyChatCache() {
  localStorage.removeItem(KEY);
}

export function createChat(agentId: string, title = "New conversation") {
  const now = Date.now();
  const entry: ChatLogEntry = {
    id: `${agentId}-${now.toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
    agentId,
    title: title.slice(0, 72),
    lastText: "",
    lastAt: now,
  };
  return entry;
}
