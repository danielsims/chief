import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DriverType,
  ProviderModelOption,
} from "@chief/agent-runtime/types";
import { parseJsonObject } from "@chief/relay-contracts";

import type { ChannelReactionSummary } from "./channel-reactions";
import type { WorkspaceChatSummary } from "./workspace-conversation-cache";
import type { WorkspaceDataState } from "./workspace-data";
import {
  applyOptimisticChannelReaction,
  foldChannelReactions,
} from "./channel-reactions";
import {
  pendingOnboardingWorkStorageKey,
  readPendingOnboardingWork,
} from "./pending-onboarding-work";
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

  const remove = (chatId: string) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setChats((current) => {
      const next = current.filter((chat) => chat.id !== chatId);
      cacheWorkspaceChats(workspaceId, next);
      return next;
    });
    client.send({
      type: "deleteChat",
      chatId,
      workspaceId,
      executorCapability: capability,
    });
  };

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
    remove,
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

export function useProviderModels(driver: DriverType | null) {
  const { client, status } = useRuntime();
  // Cached across mounts and runtime reconnects: the picker renders the last
  // known list immediately and refreshes in place.
  const [loaded, setLoaded] = useState<{
    driver: DriverType;
    models: ProviderModelOption[];
  } | null>(() =>
    driver ? { driver, models: cachedProviderModels(driver) } : null,
  );

  useEffect(() => {
    const cached = driver ? cachedProviderModels(driver) : [];
    if (!driver) return;
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "models" && message.driver === driver) {
        const next = retainUsefulProviderModels(cached, message.models);
        providerModelsCache.set(driver, next);
        writeCachedProviderModels(driver, next);
        setLoaded({ driver, models: next });
      }
    });
    // RuntimeClient queues this request while its socket reconnects. Keeping
    // the subscription alive lets onboarding retain the last useful list and
    // refresh it as soon as the bundled runtime is ready.
    client.send({ type: "listModels", driver });
    return () => {
      unsubscribe();
    };
  }, [client, driver, status]);

  const models =
    driver && loaded?.driver === driver
      ? loaded.models
      : driver
        ? cachedProviderModels(driver)
        : [];
  return { models, loading: driver !== null && models.length === 0 };
}

export const workspaceDataCache = new Map<string, WorkspaceDataState>();

export function updatePendingOnboardingDriver(
  workspaceId: string,
  driver: DriverType,
  model: string | null,
) {
  const stored = readPendingOnboardingWork(workspaceId);
  if (!stored) return false;
  try {
    const pending = parseJsonObject(JSON.parse(stored));
    if (!pending) return false;
    window.localStorage.setItem(
      pendingOnboardingWorkStorageKey(workspaceId),
      JSON.stringify({ ...pending, driver, model }),
    );
    return true;
  } catch {
    return false;
  }
}
