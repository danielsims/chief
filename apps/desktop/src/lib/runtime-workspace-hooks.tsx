import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DriverType,
  ProviderModelOption,
} from "@chief/agent-runtime/types";

import type { ChannelReactionSummary } from "./channel-reactions";
import type { WorkspaceChatSummary } from "./workspace-conversation-cache";
import type { WorkspaceDataState } from "./workspace-data";
import {
  applyOptimisticChannelReaction,
  foldChannelReactions,
} from "./channel-reactions";
import { loadLocalProviderModels } from "./hosted-provider-models";
import {
  readCachedProviderModels,
  retainUsefulProviderModels,
  writeCachedProviderModels,
} from "./provider-model-cache";
/** Durable NIP-29 events for channel timelines and message search. */
import { useChannelEvents } from "./runtime-channels";
import { useRuntime } from "./runtime-provider";
import { useWorkspaceCapability } from "./workspace-capability";
import {
  isWorkspaceAgentId,
  WORKSPACE_AGENT_IDENTITIES,
} from "./workspace-channels";
import {
  activateWorkspaceConversationCache,
  cachedWorkspaceChats,
  cacheWorkspaceChats,
} from "./workspace-conversation-cache";

export type LocalChatSummary = WorkspaceChatSummary;

/** Durable chats from the runtime-owned local libSQL database. */
export function useLocalChats(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const scopedWorkspaceId =
    workspaceId && workspaceId === cloudOrganizationId ? workspaceId : null;
  if (!cloudOrganizationId) activateWorkspaceConversationCache(null);
  else if (scopedWorkspaceId) {
    activateWorkspaceConversationCache(scopedWorkspaceId);
  }
  const [chats, setChats] = useState<LocalChatSummary[]>(() =>
    workspaceId ? (cachedWorkspaceChats(workspaceId) ?? []) : [],
  );
  const [resolved, setResolved] = useState(() =>
    Boolean(workspaceId && cachedWorkspaceChats(workspaceId)),
  );
  const [chatsWorkspaceId, setChatsWorkspaceId] = useState(workspaceId);
  const visibleChats = !scopedWorkspaceId
    ? []
    : chatsWorkspaceId === workspaceId
      ? chats
      : (cachedWorkspaceChats(scopedWorkspaceId) ?? []);
  const visibleResolved =
    Boolean(scopedWorkspaceId) && chatsWorkspaceId === workspaceId
      ? resolved
      : Boolean(scopedWorkspaceId && cachedWorkspaceChats(scopedWorkspaceId));

  useEffect(() => {
    if (
      !workspaceId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "chats" && message.workspaceId === workspaceId) {
        cacheWorkspaceChats(workspaceId, message.chats);
        setChatsWorkspaceId(workspaceId);
        setChats(message.chats);
        setResolved(true);
      }
    });
    client.send({
      type: "listChats",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  const startDirectMessage = useCallback(
    async (agentId: string) => {
      if (!scopedWorkspaceId || status !== "connected") {
        throw new Error("The Chief relay is still connecting.");
      }
      const chatId = await client.startDirectMessage(agentId);
      setChatsWorkspaceId(scopedWorkspaceId);
      setResolved(true);
      setChats((current) => {
        if (current.some((chat) => chat.id === chatId)) return current;
        const identity = isWorkspaceAgentId(agentId)
          ? WORKSPACE_AGENT_IDENTITIES[agentId]
          : null;
        const next = [
          ...current,
          {
            id: chatId,
            agent: agentId,
            title: identity?.name ?? agentId,
            lastText: "",
            lastAt: 0,
            running: false,
          },
        ];
        cacheWorkspaceChats(scopedWorkspaceId, next);
        return next;
      });
      return chatId;
    },
    [client, scopedWorkspaceId, status],
  );

  return {
    chats: visibleChats,
    loading: !visibleResolved,
    startDirectMessage,
  };
}

export { useChannelEvents } from "./runtime-channels";
export { useWorkspaceChannels } from "./workspace-channels-context";

function reactionIntentKey(messageId: string, emoji: string) {
  return `${messageId}\0${emoji}`;
}

/** Durable NIP-25 reactions folded onto the local IDs used by chat messages. */
export function useChannelReactions(channelId: string | null) {
  const { events } = useChannelEvents(channelId);
  const { client } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [optimistic, setOptimistic] = useState<
    ReadonlyMap<
      string,
      { messageId: string; emoji: string; reacted: boolean; token: string }
    >
  >(new Map());

  const durableReactions = useMemo(
    () => foldChannelReactions(events),
    [events],
  );

  const reactions = useMemo(() => {
    let next: ReadonlyMap<string, readonly ChannelReactionSummary[]> =
      durableReactions;
    for (const intent of optimistic.values()) {
      const durable = durableReactions
        .get(intent.messageId)
        ?.find((reaction) => reaction.emoji === intent.emoji);
      if (Boolean(durable?.reacted) === intent.reacted) continue;
      next = applyOptimisticChannelReaction(
        next,
        intent.messageId,
        intent.emoji,
        intent.reacted,
      );
    }
    return next;
  }, [durableReactions, optimistic]);

  const toggleReaction = useCallback(
    (messageId: string, reaction: string) => {
      if (!cloudOrganizationId || !channelId || !capability) return;
      const current = reactions
        .get(messageId)
        ?.find((item) => item.emoji === reaction);
      const reacted = !current?.reacted;
      const key = reactionIntentKey(messageId, reaction);
      const token = crypto.randomUUID();
      setOptimistic((previous) =>
        new Map(previous).set(key, {
          messageId,
          emoji: reaction,
          reacted,
          token,
        }),
      );
      client.send({
        type: "reactToChannelMessage",
        workspaceId: cloudOrganizationId,
        channelId,
        messageId,
        reaction,
        executorCapability: capability,
      });

      window.setTimeout(() => {
        setOptimistic((previous) => {
          if (previous.get(key)?.token !== token) return previous;
          const next = new Map(previous);
          next.delete(key);
          return next;
        });
      }, 5_000);
    },
    [capability, channelId, client, cloudOrganizationId, reactions],
  );

  return { reactions, toggleReaction };
}

const providerModelsCache = new Map<DriverType, ProviderModelOption[]>();

function cachedProviderModels(driver: DriverType) {
  const memory = providerModelsCache.get(driver);
  if (memory) return memory;
  const stored = readCachedProviderModels(driver);
  if (stored.length > 0) providerModelsCache.set(driver, stored);
  return stored;
}

/**
 * An agent app's models, asked of the app on this device. Setup lists them
 * before any workspace exists; once connected, the runtime also shares them
 * with the workspace. A failed lookup says so and can be retried.
 */
export function useProviderModels(driver: DriverType | null) {
  const { client, status } = useRuntime();
  // Cached across mounts: the picker renders the last known list immediately
  // and refreshes in place.
  const [loaded, setLoaded] = useState<{
    driver: DriverType;
    models: ProviderModelOption[];
    error: string | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!driver) return;
    let stopped = false;
    const cached = cachedProviderModels(driver);
    loadLocalProviderModels(driver).then(
      (listed) => {
        if (stopped) return;
        const next = retainUsefulProviderModels(cached, [
          { value: "", label: "Auto" },
          ...listed,
        ]);
        providerModelsCache.set(driver, next);
        writeCachedProviderModels(driver, next);
        setLoaded({ driver, models: next, error: null });
      },
      (cause: Error) => {
        if (!stopped)
          setLoaded({ driver, models: cached, error: cause.message });
      },
    );
    return () => {
      stopped = true;
    };
  }, [driver, attempt]);

  // Device models are shared with the workspace so its members see them.
  useEffect(() => {
    if (status !== "connected" || (driver !== "codex" && driver !== "claude"))
      return;
    client.send({ type: "listModels", driver });
  }, [client, driver, status]);

  const current = driver && loaded?.driver === driver ? loaded : null;
  const models =
    current?.models ?? (driver ? cachedProviderModels(driver) : []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    models,
    loading: driver !== null && current === null && models.length === 0,
    error: current?.error ?? null,
    retry,
  };
}

export const workspaceDataCache = new Map<string, WorkspaceDataState>();
