/** Legacy browser metadata retained only while existing installations migrate
 * to the runtime-owned local database. New chats are durable there instead. */

export interface ChatLogEntry {
  id: string;
  agentId: string;
  title: string;
  /** Last message the user sent, shown as the row preview. */
  lastText: string;
  lastAt: number;
  driver?: import("@marketer/agent-runtime/types").DriverType;
  model?: string;
}

const KEY = "marketer-chat-log";

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

export function deleteChat(chatId: string) {
  saveChatLog(getChatLog().filter((entry) => entry.id !== chatId));
}
