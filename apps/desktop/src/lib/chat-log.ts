/**
 * Local record of conversations the user has opened or sent to. The runtime
 * has no "list chats" protocol yet, so the conversations page derives its
 * list from this log. One chat per agent for now (chatId `${agentId}-main`).
 */

export interface ChatLogEntry {
  agentId: string;
  /** Last message the user sent, shown as the row preview. */
  lastText: string;
  lastAt: number;
}

const KEY = "marketer-chat-log";
const EVENT = "marketer-chat-log-changed";

export function getChatLog(): ChatLogEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as ChatLogEntry[])
      .filter((e) => typeof e?.agentId === "string")
      .sort((a, b) => b.lastAt - a.lastAt);
  } catch {
    return [];
  }
}

export function recordChat(agentId: string, lastText: string) {
  const rest = getChatLog().filter((e) => e.agentId !== agentId);
  const next: ChatLogEntry[] = [
    { agentId, lastText: lastText.slice(0, 200), lastAt: Date.now() },
    ...rest,
  ];
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onChatLogChange(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
