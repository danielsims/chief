import { createContext } from "react";

import type { ChannelInboxMessage } from "./channel-inbox";

export interface ChannelReadStateValue {
  inboxMessages: readonly ChannelInboxMessage[];
  unreadChannelCounts: ReadonlyMap<string, number>;
  workspaceUnreadCounts: ReadonlyMap<string, number>;
  markChannelRead: (channelId: string) => void;
  markThreadRead: (channelId: string, rootId: string) => void;
  setVisibleThread: (channelId: string, rootId: string | null) => void;
}

export const ChannelReadStateContext =
  createContext<ChannelReadStateValue | null>(null);
