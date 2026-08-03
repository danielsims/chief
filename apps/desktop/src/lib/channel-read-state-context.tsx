/* eslint-disable max-lines */

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";

import type { ChannelEvent } from "@chief/agent-runtime/types";

import type {
  ChannelReadStateBlob,
  ObservedChannelMessage,
} from "./channel-read-state";
import { useAuth } from "./auth/auth-context";
import {
  advanceReadContext,
  channelContextKey,
  EMPTY_CHANNEL_READ_STATE,
  mergeObservedMessageSnapshot,
  observedChannelMessage,
  parseChannelReadState,
  threadContextKey,
  unreadCountsByChannel,
} from "./channel-read-state";
import {
  messageNotificationTarget,
  notifySystem,
  syncDesktopUnreadBadge,
} from "./notifications";
import {
  useRuntime,
  useWorkspaceCapability,
  useWorkspaceChannels,
} from "./runtime";

interface ChannelReadStateValue {
  unreadChannelCounts: ReadonlyMap<string, number>;
  markChannelRead: (channelId: string) => void;
  markThreadRead: (channelId: string, rootId: string) => void;
  setVisibleThread: (channelId: string, rootId: string | null) => void;
}

const ChannelReadStateContext = createContext<ChannelReadStateValue | null>(
  null,
);

const MAX_SEEN_LIVE_EVENTS = 500;

function recordSeenEvent(seen: Set<string>, eventId: string) {
  seen.add(eventId);
  if (seen.size <= MAX_SEEN_LIVE_EVENTS) return;
  const oldest = seen.values().next().value;
  if (typeof oldest === "string") seen.delete(oldest);
}

function storageKey(workspaceId: string, readerId: string) {
  return `chief:channel-read-state:v1:${workspaceId}:${readerId}`;
}

function readState(workspaceId: string, readerId: string) {
  try {
    return parseChannelReadState(
      JSON.parse(
        window.localStorage.getItem(storageKey(workspaceId, readerId)) ??
          "null",
      ) as unknown,
    );
  } catch {
    return EMPTY_CHANNEL_READ_STATE;
  }
}

function writeState(
  workspaceId: string,
  readerId: string,
  state: ChannelReadStateBlob,
) {
  try {
    window.localStorage.setItem(
      storageKey(workspaceId, readerId),
      JSON.stringify(state),
    );
  } catch {
    // Read state is recoverable from channel history; storage failures are safe.
  }
}

function messagesFrom(events: readonly ChannelEvent[]) {
  return new Map(
    events.flatMap((event): [string, ObservedChannelMessage][] => {
      const message = observedChannelMessage(event);
      return message ? [[message.id, message]] : [];
    }),
  );
}

function sourceAliasesFrom(events: readonly ChannelEvent[]) {
  const aliases = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== 9) continue;
    const sourceId = event.tags.find((tag) => tag[0] === "client")?.[1];
    if (sourceId) aliases.set(sourceId, event.id);
  }
  return aliases;
}

function latestTimestamp(
  messages: Iterable<ObservedChannelMessage>,
  predicate: (message: ObservedChannelMessage) => boolean,
) {
  let latest: number | null = null;
  for (const message of messages) {
    if (!predicate(message)) continue;
    latest =
      latest === null ? message.createdAt : Math.max(latest, message.createdAt);
  }
  return latest;
}

export function ChannelReadStateProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { cloudOrganizationId, user } = useAuth();
  if (!cloudOrganizationId || !user) {
    return (
      <ChannelReadStateContext.Provider
        value={{
          unreadChannelCounts: new Map(),
          markChannelRead: () => undefined,
          markThreadRead: () => undefined,
          setVisibleThread: () => undefined,
        }}
      >
        {children}
      </ChannelReadStateContext.Provider>
    );
  }
  return (
    <ScopedChannelReadStateProvider
      key={`${cloudOrganizationId}:${user.id}`}
      workspaceId={cloudOrganizationId}
      readerId={user.id}
    >
      {children}
    </ScopedChannelReadStateProvider>
  );
}

function ScopedChannelReadStateProvider({
  children,
  readerId,
  workspaceId,
}: {
  children: ReactNode;
  readerId: string;
  workspaceId: string;
}) {
  const { capability } = useWorkspaceCapability();
  const { client, status } = useRuntime();
  const { channels } = useWorkspaceChannels();
  const location = useLocation();
  const [readMarkers, setReadMarkers] = useState(() =>
    readState(workspaceId, readerId),
  );
  const [observedByChannel, setObservedByChannel] = useState(
    new Map<string, Map<string, ObservedChannelMessage>>(),
  );
  const observedRef = useRef(observedByChannel);
  const hydratedChannelsRef = useRef(new Set<string>());
  const sourceAliasesRef = useRef(new Map<string, Map<string, string>>());
  const [startedAt] = useState(() => Date.now());
  const seenLiveEventsRef = useRef(new Set<string>());
  const liveMessageIdsRef = useRef(new Set<string>());
  const visibleThreadRef = useRef<{ channelId: string; rootId: string } | null>(
    null,
  );
  const locationRef = useRef(location);
  const channelsRef = useRef(channels);

  useEffect(() => {
    observedRef.current = observedByChannel;
  }, [observedByChannel]);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  const updateMarkers = useCallback(
    (update: (current: ChannelReadStateBlob) => ChannelReadStateBlob) => {
      setReadMarkers((current) => {
        const next = update(current);
        if (next === current) return current;
        writeState(workspaceId, readerId, next);
        return next;
      });
    },
    [readerId, workspaceId],
  );

  const markChannelRead = useCallback(
    (channelId: string) => {
      const messages = observedRef.current.get(channelId)?.values() ?? [];
      const latest = latestTimestamp(messages, (message) => !message.rootId);
      if (latest === null) return;
      updateMarkers((current) =>
        advanceReadContext(current, channelContextKey(channelId), latest),
      );
    },
    [updateMarkers],
  );

  const canonicalRootId = useCallback((channelId: string, rootId: string) => {
    const aliased = sourceAliasesRef.current.get(channelId)?.get(rootId);
    if (aliased) return aliased;
    const messages = observedRef.current.get(channelId);
    if (!messages) return rootId;
    for (const message of messages.values()) {
      if (message.id === rootId || message.sourceId === rootId)
        return message.id;
    }
    return rootId;
  }, []);

  const markThreadRead = useCallback(
    (channelId: string, rootId: string) => {
      const canonical = canonicalRootId(channelId, rootId);
      const messages = observedRef.current.get(channelId)?.values() ?? [];
      const latest = latestTimestamp(
        messages,
        (message) => message.rootId === canonical,
      );
      if (latest === null) return;
      updateMarkers((current) =>
        advanceReadContext(
          current,
          threadContextKey(channelId, canonical),
          latest,
        ),
      );
    },
    [canonicalRootId, updateMarkers],
  );

  const setVisibleThread = useCallback(
    (channelId: string, rootId: string | null) => {
      visibleThreadRef.current = rootId ? { channelId, rootId } : null;
    },
    [],
  );

  const activeChannelId = useMemo(() => {
    if (!location.pathname.startsWith("/conversations")) return null;
    const params = new URLSearchParams(location.search);
    const requested = params.get("channel");
    const requestedDm = params.get("dm");
    if (requestedDm) {
      return (
        channels.find(
          (channel) =>
            channel.visibility === "direct" &&
            channel.agentIds.includes(requestedDm),
        )?.id ?? null
      );
    }
    if (!requested)
      return channels.find((channel) => channel.slug === "general")?.id ?? null;
    return (
      channels.find(
        (channel) => channel.id === requested || channel.slug === requested,
      )?.id ?? null
    );
  }, [channels, location.pathname, location.search]);

  useEffect(() => {
    if (!activeChannelId || document.visibilityState !== "visible") return;
    markChannelRead(activeChannelId);
  }, [activeChannelId, markChannelRead, observedByChannel]);

  useEffect(() => {
    const markVisible = () => {
      if (document.visibilityState !== "visible") return;
      const current = locationRef.current;
      if (!current.pathname.startsWith("/conversations")) return;
      const params = new URLSearchParams(current.search);
      const requested = params.get("channel");
      const requestedDm = params.get("dm");
      const channel = channelsRef.current.find(
        (candidate) =>
          candidate.id === requested ||
          candidate.slug === requested ||
          (requestedDm !== null &&
            candidate.visibility === "direct" &&
            candidate.agentIds.includes(requestedDm)) ||
          (!requested && !requestedDm && candidate.slug === "general"),
      );
      if (channel) markChannelRead(channel.id);
      const thread = visibleThreadRef.current;
      if (thread) markThreadRead(thread.channelId, thread.rootId);
    };
    window.addEventListener("focus", markVisible);
    document.addEventListener("visibilitychange", markVisible);
    return () => {
      window.removeEventListener("focus", markVisible);
      document.removeEventListener("visibilitychange", markVisible);
    };
  }, [markChannelRead, markThreadRead]);

  useEffect(() => {
    if (!capability || status !== "connected") return;
    const notifyForMessage = (
      observed: ObservedChannelMessage,
      title: string,
      content: string,
    ) => {
      const currentLocation = locationRef.current;
      const routeChannel = channelsRef.current.find((channel) => {
        const params = new URLSearchParams(currentLocation.search);
        const requested = params.get("channel");
        const requestedDm = params.get("dm");
        return (
          currentLocation.pathname.startsWith("/conversations") &&
          (channel.id === requested ||
            channel.slug === requested ||
            (requestedDm !== null &&
              channel.visibility === "direct" &&
              channel.agentIds.includes(requestedDm)) ||
            (!requested && !requestedDm && channel.slug === "general"))
        );
      });
      const isVisibleTopLevel =
        !observed.rootId &&
        routeChannel?.id === observed.channelId &&
        document.visibilityState === "visible" &&
        document.hasFocus();
      // Thread replies are explicit agent/user responses and always notify,
      // even while the parent channel or exact thread is visible. Only an
      // ordinary top-level message in the focused channel is silent.
      if (isVisibleTopLevel) return;

      const channel = channelsRef.current.find(
        (candidate) => candidate.id === observed.channelId,
      );
      const directAgentId =
        channel?.visibility === "direct" ? channel.agentIds[0] : undefined;
      const aliases = sourceAliasesRef.current.get(observed.channelId);
      const threadSourceId = observed.rootId
        ? ([...(aliases?.entries() ?? [])].find(
            ([, eventId]) => eventId === observed.rootId,
          )?.[0] ?? observed.rootId)
        : null;
      const messageTarget = messageNotificationTarget({
        channelId: observed.channelId,
        channelSlug: channel?.slug,
        directAgentId,
        messageId: observed.sourceId ?? observed.id,
        threadRootId: threadSourceId,
      });
      void notifySystem(
        title,
        content.trim().length > 0
          ? content.trim().slice(0, 180)
          : "Sent an attachment",
        messageTarget,
      );
    };
    const recordLiveMessage = (
      observed: ObservedChannelMessage,
      title: string,
      content: string,
    ) => {
      if (seenLiveEventsRef.current.has(observed.id)) return;
      recordSeenEvent(seenLiveEventsRef.current, observed.id);
      recordSeenEvent(liveMessageIdsRef.current, observed.id);
      setObservedByChannel((current) => {
        const next = new Map(current);
        const messages = new Map(next.get(observed.channelId) ?? []);
        messages.set(observed.id, observed);
        next.set(observed.channelId, messages);
        return next;
      });
      notifyForMessage(observed, title, content);
    };
    const unsubscribe = client.subscribe((message) => {
      if (message.type !== "channelEvents" && message.type !== "channelEvent")
        return;
      if (message.workspaceId !== workspaceId) return;
      if (message.type === "channelEvents") {
        const nextMessages = messagesFrom(message.events);
        sourceAliasesRef.current.set(
          message.channelId,
          sourceAliasesFrom(message.events),
        );
        for (const id of [...nextMessages.keys()].slice(
          -MAX_SEEN_LIVE_EVENTS,
        )) {
          recordSeenEvent(seenLiveEventsRef.current, id);
        }
        setObservedByChannel((current) => {
          const next = new Map(current);
          next.set(
            message.channelId,
            mergeObservedMessageSnapshot(
              nextMessages,
              next.get(message.channelId),
              liveMessageIdsRef.current,
            ),
          );
          return next;
        });
        if (!hydratedChannelsRef.current.has(message.channelId)) {
          hydratedChannelsRef.current.add(message.channelId);
          const context = channelContextKey(message.channelId);
          updateMarkers((current) => {
            if (current.contexts[context] !== undefined) return current;
            const latestBeforeMount = latestTimestamp(
              nextMessages.values(),
              (candidate) => candidate.createdAt <= startedAt,
            );
            return latestBeforeMount === null
              ? current
              : advanceReadContext(current, context, latestBeforeMount);
          });
        }
        return;
      }
      if (message.event.kind === 9) {
        const sourceId = message.event.tags.find(
          (tag) => tag[0] === "client",
        )?.[1];
        if (sourceId) {
          const aliases = new Map(
            sourceAliasesRef.current.get(message.event.channelId) ?? [],
          );
          aliases.set(sourceId, message.event.id);
          sourceAliasesRef.current.set(message.event.channelId, aliases);
        }
      }
      const observed = observedChannelMessage(message.event);
      if (!observed) return;
      const channel = channelsRef.current.find(
        (candidate) => candidate.id === observed.channelId,
      );
      const sourceId = observed.sourceId ?? observed.id;
      recordLiveMessage(
        { ...observed, id: sourceId },
        channel?.visibility === "direct"
          ? message.event.actor.name
          : `${message.event.actor.name} in #${channel?.name ?? "channel"}`,
        message.event.content,
      );
    });

    for (const channel of channels) {
      client.send({
        type: "listChannelEvents",
        workspaceId,
        channelId: channel.id,
        executorCapability: capability,
      });
    }
    return () => {
      unsubscribe();
    };
  }, [
    capability,
    canonicalRootId,
    channels,
    client,
    startedAt,
    status,
    updateMarkers,
    workspaceId,
  ]);

  const unreadChannelCounts = useMemo(
    () =>
      unreadCountsByChannel(
        readMarkers,
        [...observedByChannel.values()].flatMap((messages) => [
          ...messages.values(),
        ]),
      ),
    [observedByChannel, readMarkers],
  );
  const totalUnread = useMemo(() => {
    let total = 0;
    for (const count of unreadChannelCounts.values()) total += count;
    return total;
  }, [unreadChannelCounts]);
  useEffect(() => {
    void syncDesktopUnreadBadge(totalUnread);
  }, [totalUnread]);
  const value = useMemo<ChannelReadStateValue>(
    () => ({
      unreadChannelCounts,
      markChannelRead,
      markThreadRead,
      setVisibleThread,
    }),
    [markChannelRead, markThreadRead, setVisibleThread, unreadChannelCounts],
  );

  return (
    <ChannelReadStateContext.Provider value={value}>
      {children}
    </ChannelReadStateContext.Provider>
  );
}

export function useChannelReadState() {
  const value = useContext(ChannelReadStateContext);
  if (!value) {
    throw new Error(
      "useChannelReadState must be used inside ChannelReadStateProvider",
    );
  }
  return value;
}
