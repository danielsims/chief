export interface ChannelReferenceTarget {
  id: string;
  name: string;
  slug?: string;
}

export interface ChannelReferenceSegment {
  type: "channel";
  channelId: string;
  label: string;
}

interface TextSegment {
  type: "text";
  value: string;
}

const CHANNEL_REFERENCE_PATTERN =
  /(?<![\p{L}\p{N}_])#([\p{L}\p{N}][\p{L}\p{N}_-]*)(?![\p{L}\p{N}_-])/gu;

export function splitChannelReferences(
  text: string,
  channels: readonly ChannelReferenceTarget[],
): (ChannelReferenceSegment | TextSegment)[] {
  if (channels.length === 0) return [{ type: "text", value: text }];

  const channelsByReference = new Map<string, ChannelReferenceTarget>();
  for (const channel of channels) {
    channelsByReference.set(channel.name.toLocaleLowerCase(), channel);
    if (channel.slug) {
      channelsByReference.set(channel.slug.toLocaleLowerCase(), channel);
    }
  }

  const segments: (ChannelReferenceSegment | TextSegment)[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CHANNEL_REFERENCE_PATTERN)) {
    const reference = match[1] ?? "";
    const channel = channelsByReference.get(reference.toLocaleLowerCase());
    if (!channel) continue;
    const index = match.index;
    if (index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, index) });
    }
    segments.push({
      type: "channel",
      channelId: channel.id,
      label: `#${reference}`,
    });
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}
