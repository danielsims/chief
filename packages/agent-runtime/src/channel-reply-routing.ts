import { GETTING_STARTED_CHANNEL_ID } from "./channels/nip29.js";

const MAIN_CHANNEL_REPLY_PATTERNS = [
  /\b(?:reply|respond|answer|post)\b[\s\S]{0,64}\b(?:in|to)\s+(?:the\s+)?main\s+(?:chat|channel|conversation|timeline|feed)\b/i,
  /\b(?:reply|respond|answer|post)\b[\s\S]{0,64}\b(?:not|don['’]?t)\b[\s\S]{0,32}\b(?:in|inside|to)\s+(?:a\s+|the\s+|this\s+)?thread\b/i,
];

export function requestsMainChannelReply(text: string) {
  return MAIN_CHANNEL_REPLY_PATTERNS.some((pattern) => pattern.test(text));
}

export function channelRespondingAgentId(input: {
  channelId?: string;
  isSharedChannel: boolean;
  mentions?: readonly string[];
}) {
  if (!input.isSharedChannel) return undefined;
  return (
    input.mentions?.[0] ??
    (input.channelId === GETTING_STARTED_CHANNEL_ID ? "cmo" : undefined)
  );
}

export function channelReplyThreadRoot(input: {
  isSharedChannel: boolean;
  mentions?: readonly string[];
  messageId: string;
  text?: string;
  threadRootId?: string;
}) {
  if (input.text && requestsMainChannelReply(input.text)) return undefined;
  if (input.threadRootId) return input.threadRootId;
  if (input.isSharedChannel && input.mentions?.length) return input.messageId;
  return undefined;
}
