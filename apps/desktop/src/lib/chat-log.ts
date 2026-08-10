/** New chats are persisted by the workspace-scoped runtime after first use. */

import type { DriverType } from "@chief/agent-runtime/types";

export interface ChatLogEntry {
  id: string;
  title: string;
  /** Last message the user sent, shown as the row preview. */
  lastText: string;
  lastAt: number;
  driver?: DriverType;
  model?: string;
}

export function createChat(title = "New conversation") {
  const now = Date.now();
  const entry: ChatLogEntry = {
    id: crypto.randomUUID(),
    title: title.slice(0, 72),
    lastText: "",
    lastAt: now,
  };
  return entry;
}
