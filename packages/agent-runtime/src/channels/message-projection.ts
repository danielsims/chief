import type {
  ChannelActor,
  ChannelEvent,
  ChannelMessageEvent,
} from "../channel-types.js";

export interface ProjectedReaction {
  emoji: string;
  count: number;
  members: ChannelActor[];
  reacted: boolean;
}

export interface ProjectedChannelMessage {
  id: string;
  channelId: string;
  content: string;
  parts?: unknown[];
  actor: ChannelActor;
  createdAt: number;
  editedAt?: number;
  deletedAt?: number;
  deleted: boolean;
  threadRootId?: string;
  replyCount: number;
  reactions: ProjectedReaction[];
  version: number;
}

function targetId(event: ChannelEvent, marker?: string) {
  return event.tags.find(
    (tag) => tag[0] === "e" && (marker === undefined || tag[3] === marker),
  )?.[1];
}

function sameActor(left: ChannelActor, right: ChannelActor) {
  return left.type === right.type && left.id === right.id;
}

function isChannelAction(event: ChannelMessageEvent) {
  return event.tags.some((tag) => tag[0] === "action");
}

export function isDeleted(events: readonly ChannelEvent[], eventId: string) {
  return events.some(
    (event) => event.kind === 5 && targetId(event) === eventId,
  );
}

export function messageById(
  events: readonly ChannelEvent[],
  messageId: string,
  viewer?: ChannelActor,
): ProjectedChannelMessage | undefined {
  const message = events.find(
    (event): event is ChannelMessageEvent =>
      event.kind === 9 && event.id === messageId,
  );
  if (!message) return undefined;
  const edits = events
    .filter(
      (event) =>
        event.kind === 40003 &&
        targetId(event, "edit") === message.id &&
        sameActor(event.actor, message.actor),
    )
    .sort((left, right) => left.createdAt - right.createdAt);
  const latestEdit = edits.at(-1);
  const deletion = events
    .filter(
      (event) =>
        event.kind === 5 &&
        targetId(event) === message.id &&
        sameActor(event.actor, message.actor),
    )
    .sort((left, right) => left.createdAt - right.createdAt)
    .at(-1);
  const reactions = events.filter(
    (event) =>
      event.kind === 7 &&
      targetId(event, "reply") === message.id &&
      !isDeleted(events, event.id),
  );
  const grouped = new Map<string, ChannelActor[]>();
  for (const reaction of reactions) {
    const members = grouped.get(reaction.content) ?? [];
    if (!members.some((member) => sameActor(member, reaction.actor))) {
      members.push(reaction.actor);
    }
    grouped.set(reaction.content, members);
  }
  const replies = events.filter(
    (event) =>
      event.kind === 9 &&
      event.id !== message.id &&
      targetId(event, "root") === message.id &&
      !isDeleted(events, event.id),
  );
  return {
    id: message.id,
    channelId: message.channelId,
    content: deletion ? "" : (latestEdit?.content ?? message.content),
    parts: deletion ? undefined : message.parts,
    actor: message.actor,
    createdAt: message.createdAt,
    editedAt: latestEdit?.createdAt,
    deletedAt: deletion?.createdAt,
    deleted: Boolean(deletion),
    threadRootId: targetId(message, "root"),
    replyCount: replies.length,
    reactions: [...grouped.entries()]
      .map(([emoji, members]) => ({
        emoji,
        count: members.length,
        members,
        reacted: viewer
          ? members.some((member) => sameActor(member, viewer))
          : false,
      }))
      .sort((left, right) => left.emoji.localeCompare(right.emoji)),
    version: 1 + edits.length,
  };
}

export function channelMessages(
  events: readonly ChannelEvent[],
  viewer?: ChannelActor,
) {
  return events
    .filter(
      (event): event is ChannelMessageEvent =>
        event.kind === 9 && !isChannelAction(event),
    )
    .map((event) => messageById(events, event.id, viewer))
    .filter((message): message is ProjectedChannelMessage => Boolean(message));
}

export function channelTimeline(
  events: readonly ChannelEvent[],
  viewer?: ChannelActor,
) {
  return channelMessages(events, viewer).filter(
    (message) => !message.threadRootId,
  );
}

export function threadMessages(
  events: readonly ChannelEvent[],
  rootId: string,
  viewer?: ChannelActor,
) {
  const messages = channelMessages(events, viewer);
  return messages.filter(
    (message) => message.id === rootId || message.threadRootId === rootId,
  );
}

export function cursorPage<T extends { id: string; createdAt: number }>(
  items: readonly T[],
  input: { cursor?: string | null; limit?: number; newestFirst?: boolean },
) {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const ordered = [...items].sort((left, right) =>
    input.newestFirst === false
      ? left.createdAt - right.createdAt
      : right.createdAt - left.createdAt,
  );
  const start = input.cursor
    ? Math.max(0, ordered.findIndex((item) => item.id === input.cursor) + 1)
    : 0;
  const page = ordered.slice(start, start + limit);
  return {
    items: page,
    nextCursor:
      start + page.length < ordered.length ? page.at(-1)?.id : undefined,
  };
}

export function actorOwnsMessage(
  message: ProjectedChannelMessage,
  actor: ChannelActor,
) {
  return sameActor(message.actor, actor);
}
