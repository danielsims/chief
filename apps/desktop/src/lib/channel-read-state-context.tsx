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

import type { ChannelInboxMessage } from "./channel-inbox";
import type {
  ChannelReadStateBlob,
  ObservedChannelMessage,
} from "./channel-read-state";
import { useAuth } from "./auth/auth-context";
import { channelForConversationRoute } from "./channel-conversation-route";
import { channelInboxMessages } from "./channel-inbox";
import {
  advanceReadContext,
  channelContextKey,
  mergeObservedMessageSnapshot,
  observedChannelMessage,
  threadContextKey,
  unreadCountsByChannel,
} from "./channel-read-state";
import {
  channelMessagesFrom,
  channelSourceAliasesFrom,
  latestChannelMessageTimestamp,
  MAX_SEEN_LIVE_EVENTS,
  readChannelState,
  recordSeenChannelEvent,
  writeChannelState,
} from "./channel-read-state-storage";
import { messageNotificationTarget, notifySystem } from "./notifications";
import {
  useRuntime,
  useWorkspaceCapability,
  useWorkspaceChannels,
} from "./runtime";
import { useWorkspaceUnreadCounts } from "./workspace-unread-counts";

interface ChannelReadStateValue {
  inboxMessages: readonly ChannelInboxMessage[];
  unreadChannelCounts: ReadonlyMap<string, number>;
  workspaceUnreadCounts: ReadonlyMap<string, number>;
  markChannelRead: (channelId: string) => void;
  markThreadRead: (channelId: string, rootId: string) => void;
  setVisibleThread: (channelId: string, rootId: string | null) => void;
}

const ChannelReadStateContext = createContext<ChannelReadStateValue | null>(
  null,
);

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
          inboxMessages: [],
          unreadChannelCounts: new Map(),
          workspaceUnreadCounts: new Map(),
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
    readChannelState(workspaceId, readerId),
  );
  const [observedByChannel, setObservedByChannel] = useState(
    new Map<string, Map<string, ObservedChannelMessage>>(),
  );
  const observedRef = useRef(observedByChannel);
  const hydratedChannelsRef = useRef(new Set<string>());
  const sourceAliasesRef = useRef(new Map<string, Map<string, string>>());
  const [startedAt] = useState(() => Date.now());
  const seenLiveEventsRef = useRef(new Set<string>());
  const notifiedLiveEventsRef = useRef(new Set<string>());
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
        writeChannelState(workspaceId, readerId, next);
        return next;
      });
    },
    [readerId, workspaceId],
  );

  const markChannelRead = useCallback(
    (channelId: string) => {
      // Opening a channel is a read action for the whole channel, threads
      // included — the user should not have to step into each thread to clear
      // its badge. Advance the marker past the newest message of any kind.
      const messages = observedRef.current.get(channelId)?.values() ?? [];
      const latest = latestChannelMessageTimestamp(messages, () => true);
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
      const latest = latestChannelMessageTimestamp(
        messages,
        (message) => message.rootId === canonical,
      );
      // A thread can open before its channel snapshot finishes hydrating. The
      // visible thread is still the user's explicit read action, so advance
      // its marker to now rather than leaving an old sidebar badge stuck.
      const readAt = Math.max(latest ?? 0, Date.now());
      updateMarkers((current) =>
        advanceReadContext(
          current,
          threadContextKey(channelId, canonical),
          readAt,
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
    return (
      channelForConversationRoute(location.pathname, location.search, channels)
        ?.id ?? null
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
      const channel = channelForConversationRoute(
        current.pathname,
        current.search,
        channelsRef.current,
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
      const routeChannel = channelForConversationRoute(
        currentLocation.pathname,
        currentLocation.search,
        channelsRef.current,
      );
      const isVisibleTopLevel =
        !observed.rootId &&
        routeChannel?.id === observed.channelId &&
        document.visibilityState === "visible" &&
        document.hasFocus();
      // When the user is actively viewing the channel, top-level messages are
      // silent. The thread the agent is replying into is also silent: the user
      // is already watching those replies arrive, so a notification + sound for
      // each one is noise. Only notify for other threads and other channels.
      const visibleThread = visibleThreadRef.current;
      const isVisibleThread =
        observed.rootId !== null &&
        visibleThread?.channelId === observed.channelId &&
        visibleThread.rootId === observed.rootId &&
        document.visibilityState === "visible" &&
        document.hasFocus();
      // Thread replies are explicit agent/user responses and always notify
      // when away, but not when the exact thread is already on screen.
      if (isVisibleTopLevel || isVisibleThread) return;

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
      // Thread replies are explicit agent/user responses and must notify even
      // when the event was seen in an earlier history batch — the user is away
      // from the channel and expects a ping. The seen-set gates read-state
      // bookkeeping, not delivery.
      if (observed.rootId && !notifiedLiveEventsRef.current.has(observed.id)) {
        notifiedLiveEventsRef.current.add(observed.id);
        notifyForMessage(observed, title, content);
      }
      if (seenLiveEventsRef.current.has(observed.id)) return;
      recordSeenChannelEvent(seenLiveEventsRef.current, observed.id);
      recordSeenChannelEvent(liveMessageIdsRef.current, observed.id);
      setObservedByChannel((current) => {
        const next = new Map(current);
        const messages = new Map(next.get(observed.channelId) ?? []);
        messages.set(observed.id, observed);
        next.set(observed.channelId, messages);
        return next;
      });
      if (!observed.rootId) {
        notifyForMessage(observed, title, content);
      }
    };
    const unsubscribe = client.subscribe((message) => {
      if (message.type !== "channelEvents" && message.type !== "channelEvent")
        return;
      if (message.workspaceId !== workspaceId) return;
      if (message.type === "channelEvents") {
        const nextMessages = channelMessagesFrom(message.events);
        sourceAliasesRef.current.set(
          message.channelId,
          channelSourceAliasesFrom(message.events),
        );
        for (const id of [...nextMessages.keys()].slice(
          -MAX_SEEN_LIVE_EVENTS,
        )) {
          recordSeenChannelEvent(seenLiveEventsRef.current, id);
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
            const latestBeforeMount = latestChannelMessageTimestamp(
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
      const aliases = sourceAliasesRef.current.get(observed.channelId);
      const threadSourceId = observed.rootId
        ? ([...(aliases?.entries() ?? [])].find(
            ([, eventId]) => eventId === observed.rootId,
          )?.[0] ?? observed.rootId)
        : null;
      const sourceId = observed.sourceId ?? observed.id;
      recordLiveMessage(
        { ...observed, id: sourceId, threadSourceId },
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
  const inboxMessages = useMemo(
    () => channelInboxMessages(readMarkers, observedByChannel),
    [observedByChannel, readMarkers],
  );
  const totalUnread = useMemo(() => {
    let total = 0;
    for (const count of unreadChannelCounts.values()) total += count;
    return total;
  }, [unreadChannelCounts]);
  const workspaceUnreadCounts = useWorkspaceUnreadCounts(
    readerId,
    workspaceId,
    totalUnread,
  );
  const value = useMemo<ChannelReadStateValue>(
    () => ({
      inboxMessages,
      unreadChannelCounts,
      workspaceUnreadCounts,
      markChannelRead,
      markThreadRead,
      setVisibleThread,
    }),
    [
      inboxMessages,
      markChannelRead,
      markThreadRead,
      setVisibleThread,
      unreadChannelCounts,
      workspaceUnreadCounts,
    ],
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
