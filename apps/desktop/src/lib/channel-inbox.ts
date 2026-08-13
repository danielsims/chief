import type {
  ChannelReadStateBlob,
  ObservedChannelMessage,
} from "./channel-read-state";
import { isUnreadChannelMessage } from "./channel-read-state";

export interface ChannelInboxMessage extends ObservedChannelMessage {
  unread: boolean;
}

export function channelInboxMessages(
  readState: ChannelReadStateBlob,
  messagesByChannel: ReadonlyMap<
    string,
    ReadonlyMap<string, ObservedChannelMessage>
  >,
  limit = 200,
) {
  return [...messagesByChannel.values()]
    .flatMap((messages) => [...messages.values()])
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit)
    .map((message): ChannelInboxMessage => ({
      ...message,
      unread: isUnreadChannelMessage(readState, message),
    }));
}
