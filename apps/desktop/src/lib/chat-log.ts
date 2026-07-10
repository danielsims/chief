/**
 * Local record of conversations the user has opened or sent to. The runtime
 * has no "list chats" protocol yet, so the conversations page derives its
 * list from this log. Each entry owns a stable runtime chat id, so one agent
 * can have multiple independent conversations.
 */

export interface ChatLogEntry {
  id: string;
  agentId: string;
  title: string;
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
    return (parsed as Array<Partial<ChatLogEntry>>)
      .filter((e) => typeof e?.agentId === "string")
      .map((entry) => ({
        id:
          typeof entry.id === "string"
            ? entry.id
            : `${entry.agentId as string}-main`,
        agentId: entry.agentId as string,
        title:
          typeof entry.title === "string"
            ? entry.title
            : entry.lastText?.slice(0, 72) || "New conversation",
        lastText: typeof entry.lastText === "string" ? entry.lastText : "",
        lastAt: typeof entry.lastAt === "number" ? entry.lastAt : 0,
      }))
      .sort((a, b) => b.lastAt - a.lastAt);
  } catch {
    return [];
  }
}

function saveChatLog(next: ChatLogEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT));
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
  saveChatLog([entry, ...getChatLog()]);
  return entry;
}

export function recordChat(agentId: string, chatId: string, lastText: string) {
  const existing = getChatLog().find((entry) => entry.id === chatId);
  const rest = getChatLog().filter((entry) => entry.id !== chatId);
  const cleanText = lastText.trim();
  const next: ChatLogEntry[] = [
    {
      id: chatId,
      agentId,
      title:
        existing?.title && existing.title !== "New conversation"
          ? existing.title
          : cleanText.slice(0, 72) || "New conversation",
      lastText: cleanText.slice(0, 200),
      lastAt: Date.now(),
    },
    ...rest,
  ];
  saveChatLog(next);
}

export function onChatLogChange(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
