import type { ChannelEvent } from "@chief/agent-runtime/types";

export interface ChannelReactionSummary {
  emoji: string;
  count: number;
  reacted: boolean;
  names: string[];
}

export function foldChannelReactions(events: readonly ChannelEvent[]) {
  const messageIdByEventId = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== 9) continue;
    const clientId = event.tags.find((tag) => tag[0] === "client")?.[1];
    messageIdByEventId.set(event.id, clientId ?? event.id);
  }

  const folded = new Map<string, Map<string, ChannelReactionSummary>>();
  for (const event of events) {
    if (event.kind !== 7) continue;
    const targetEventId = event.tags.find((tag) => tag[0] === "e")?.[1];
    if (!targetEventId) continue;
    const messageId = messageIdByEventId.get(targetEventId) ?? targetEventId;
    const byEmoji: Map<string, ChannelReactionSummary> =
      folded.get(messageId) ?? new Map<string, ChannelReactionSummary>();
    const current: ChannelReactionSummary = byEmoji.get(event.content) ?? {
      emoji: event.content,
      count: 0,
      reacted: false,
      names: [],
    };
    byEmoji.set(event.content, {
      ...current,
      count: current.count + 1,
      reacted: current.reacted
        ? true
        : event.actor.type === "user" && event.actor.id === "workspace-owner",
      names: current.names.includes(event.actor.name)
        ? current.names
        : [...current.names, event.actor.name],
    });
    folded.set(messageId, byEmoji);
  }

  return new Map(
    [...folded].map(([messageId, byEmoji]) => [
      messageId,
      [...byEmoji.values()],
    ]),
  );
}

export function applyOptimisticChannelReaction(
  reactions: ReadonlyMap<string, readonly ChannelReactionSummary[]>,
  messageId: string,
  emoji: string,
  reacted: boolean,
) {
  const next = new Map(reactions);
  const current = [...(next.get(messageId) ?? [])];
  const index = current.findIndex((reaction) => reaction.emoji === emoji);
  const existing = index >= 0 ? current[index] : undefined;

  if (reacted) {
    if (existing?.reacted) return next;
    const updated: ChannelReactionSummary = existing
      ? {
          ...existing,
          count: existing.count + 1,
          reacted: true,
          names: existing.names.includes("You")
            ? existing.names
            : [...existing.names, "You"],
        }
      : { emoji, count: 1, reacted: true, names: ["You"] };
    if (index >= 0) current[index] = updated;
    else current.push(updated);
  } else if (existing?.reacted) {
    if (existing.count <= 1) current.splice(index, 1);
    else {
      current[index] = {
        ...existing,
        count: existing.count - 1,
        reacted: false,
        names: existing.names.filter((name) => name !== "You"),
      };
    }
  }

  if (current.length > 0) next.set(messageId, current);
  else next.delete(messageId);
  return next;
}
