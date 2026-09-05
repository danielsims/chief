import type { ReactNode } from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";

import { messageMentionsPerson } from "@chief/agent-runtime/channel-message-mentions";

import type {
  ChannelReadStateBlob,
  ObservedChannelMessage,
} from "./channel-read-state";
import type { ChannelReadStateValue } from "./channel-read-state-context-value";
import { useAuth } from "./auth/auth-context";
import { channelForConversationRoute } from "./channel-conversation-route";
import { channelInboxMessages } from "./channel-inbox";
import {
  advanceReadContext,
  channelContextKey,
  mergeObservedMessageSnapshot,
  observedChannelMessage,
  shouldDeliverChannelNotification,
  threadContextKey,
  unreadCountsByChannel,
} from "./channel-read-state";
import { ChannelReadStateContext } from "./channel-read-state-context-value";
import {
  channelMessagesFrom,
  channelSourceAliasesFrom,
  latestChannelMessageTimestamp,
  MAX_SEEN_LIVE_EVENTS,
  newSnapshotNotificationMessages,
  readChannelState,
  recordSeenChannelEvent,
  workspaceNotificationStartedAt,
  writeChannelState,
} from "./channel-read-state-storage";
import { messageNotificationTarget, notifySystem } from "./notifications";
import {
  useRuntime,
  useWorkspaceCapability,
  useWorkspaceChannels,
} from "./runtime";
import * as cache from "./workspace-conversation-cache";
import { useWorkspaceUnreadCounts } from "./workspace-unread-counts";

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
      readerName={user.name}
    >
      {children}
    </ScopedChannelReadStateProvider>
  );
}

function ScopedChannelReadStateProvider({
  children,
  readerId,
  readerName,
  workspaceId,
}: {
  children: ReactNode;
  readerId: string;
  readerName: string;
  workspaceId: string;
}) {
  const { capability } = useWorkspaceCapability();
  const { client, status } = useRuntime();
  const { channels } = useWorkspaceChannels();
  const joinedChannels = useMemo(
    () => channels.filter(({ userIds }) => userIds.includes("workspace-owner")),
    [channels],
  );
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
  const [startedAt] = useState(() =>
    workspaceNotificationStartedAt(
      Date.now(),
      sessionStorage.getItem(`chief:onboarding:${workspaceId}`),
    ),
  );
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
      // An explicit @mention is the exception — it always notifies.
      const visibleThread = visibleThreadRef.current;
      const isVisibleThread =
        observed.rootId !== null &&
        visibleThread?.channelId === observed.channelId &&
        visibleThread.rootId === observed.rootId &&
        document.visibilityState === "visible" &&
        document.hasFocus();
      const mentioned = messageMentionsPerson({
        content: observed.content,
        mentions: observed.mentionIds,
        person: { id: readerId, name: readerName },
      });
      if (
        !shouldDeliverChannelNotification({
          mentioned,
          isVisibleTopLevel,
          isVisibleThread,
        })
      ) {
        return;
      }

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
      const bannerTitle = mentioned
        ? channel?.visibility === "direct"
          ? `${observed.actor.name} mentioned you`
          : `${observed.actor.name} mentioned you in #${channel?.name ?? "channel"}`
        : title;
      void notifySystem(
        bannerTitle,
        content.trim().length > 0
          ? content.trim().slice(0, 180)
          : "Sent an attachment",
        messageTarget,
        { urgent: mentioned },
      );
    };
    const recordLiveMessage = (
      observed: ObservedChannelMessage,
      title: string,
      content: string,
    ) => {
      // Notification delivery and read-state hydration have separate
      // deduplication. A live event may already exist in a history snapshot,
      // but it still deserves exactly one notification attempt.
      if (
        observed.createdAt > startedAt &&
        !notifiedLiveEventsRef.current.has(observed.id)
      ) {
        recordSeenChannelEvent(notifiedLiveEventsRef.current, observed.id);
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
    };
    const unsubscribe = client.subscribe((message) => {
      if (message.type !== "channelEvents" && message.type !== "channelEvent")
        return;
      if (message.workspaceId !== workspaceId) return;
      if (message.type === "channelEvents") {
        const { channelId, events } = message;
        cache.cacheChannelEvents(workspaceId, channelId, events);
        const nextMessages = channelMessagesFrom(message.events);
        sourceAliasesRef.current.set(
          message.channelId,
          channelSourceAliasesFrom(message.events),
        );
        // Channel creation and subscription changes can race a specialist's
        // first messages. Those messages then arrive only in the recovery
        // snapshot. Recover their notification here while keeping all history
        // from before this provider mounted silent.
        const channel = channelsRef.current.find(
          (candidate) => candidate.id === message.channelId,
        );
        for (const observed of newSnapshotNotificationMessages(
          nextMessages.values(),
          startedAt,
          notifiedLiveEventsRef.current,
        )) {
          recordSeenChannelEvent(notifiedLiveEventsRef.current, observed.id);
          notifyForMessage(
            observed,
            channel?.visibility === "direct"
              ? observed.actor.name
              : `${observed.actor.name} in #${channel?.name ?? "channel"}`,
            observed.content,
          );
        }
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
      cache.cacheChannelEvent(workspaceId, message.event);
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

    for (const channel of joinedChannels) {
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
    joinedChannels,
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
