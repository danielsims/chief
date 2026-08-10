import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  ChannelEvent,
  WorkspaceChannel,
} from "@chief/agent-runtime/types";

import { useAuth } from "./auth/auth-context";
import { useRuntime, useWorkspaceCapability } from "./runtime";

const channelCache = new Map<string, WorkspaceChannel[]>();
const channelEventCache = new Map<string, ChannelEvent[]>();

export function useChannelEvents(channelId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const cacheKey =
    cloudOrganizationId && channelId
      ? `${cloudOrganizationId}\0${channelId}`
      : null;
  const [eventState, setEventState] = useState<{
    cacheKey: string | null;
    events: ChannelEvent[];
    loaded: boolean;
  }>(() => ({
    cacheKey,
    events: cacheKey ? (channelEventCache.get(cacheKey) ?? []) : [],
    loaded: cacheKey ? channelEventCache.has(cacheKey) : true,
  }));
  const events =
    eventState.cacheKey === cacheKey
      ? eventState.events
      : cacheKey
        ? (channelEventCache.get(cacheKey) ?? [])
        : [];
  const eventsLoaded =
    eventState.cacheKey === cacheKey ? eventState.loaded : false;

  useEffect(() => {
    if (
      !cloudOrganizationId ||
      !channelId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const activeCacheKey = `${cloudOrganizationId}\0${channelId}`;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "channelEvents" &&
        message.workspaceId === cloudOrganizationId &&
        message.channelId === channelId
      ) {
        channelEventCache.set(activeCacheKey, message.events);
        setEventState({
          cacheKey: activeCacheKey,
          events: message.events,
          loaded: true,
        });
        return;
      }
      if (
        message.type === "channelEvent" &&
        message.workspaceId === cloudOrganizationId &&
        message.event.channelId === channelId
      ) {
        setEventState((currentState) => {
          const current =
            currentState.cacheKey === activeCacheKey
              ? currentState.events
              : (channelEventCache.get(activeCacheKey) ?? []);
          if (current.some((event) => event.id === message.event.id)) {
            return {
              cacheKey: activeCacheKey,
              events: current,
              loaded: currentState.loaded,
            };
          }
          const next = [...current, message.event];
          channelEventCache.set(activeCacheKey, next);
          return {
            cacheKey: activeCacheKey,
            events: next,
            loaded: true,
          };
        });
      }
    });
    client.send({
      type: "listChannelEvents",
      workspaceId: cloudOrganizationId,
      channelId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [cacheKey, capability, channelId, client, cloudOrganizationId, status]);

  return { events, loaded: eventsLoaded };
}

/** Durable NIP-29 destinations, including user-created workspace channels. */
export function useWorkspaceChannels() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const { sessionToken } = useAuth();
  const pendingCreates = useRef(
    new Map<
      string,
      {
        resolve: (channelId: string | null) => void;
        timeout: number;
      }
    >(),
  );
  const pendingDeletes = useRef(
    new Map<
      string,
      {
        reject: (error: Error) => void;
        resolve: () => void;
        timeout: number;
      }
    >(),
  );
  const pendingUpdates = useRef(
    new Map<
      string,
      {
        reject: (error: Error) => void;
        resolve: () => void;
        timeout: number;
      }
    >(),
  );
  const pendingPolicies = useRef(
    new Map<
      string,
      {
        reject: (error: Error) => void;
        resolve: () => void;
        timeout: number;
      }
    >(),
  );
  const [channels, setChannels] = useState<WorkspaceChannel[]>(() =>
    cloudOrganizationId ? (channelCache.get(cloudOrganizationId) ?? []) : [],
  );

  useEffect(() => {
    if (!cloudOrganizationId || !capability || status !== "connected") return;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "channels" &&
        message.workspaceId === cloudOrganizationId
      ) {
        channelCache.set(cloudOrganizationId, message.channels);
        setChannels(message.channels);
      }
      if (
        message.type === "channelCreated" &&
        message.workspaceId === cloudOrganizationId
      ) {
        setChannels((current) => {
          const next = current.some(
            (channel) => channel.id === message.channel.id,
          )
            ? current
            : [...current, message.channel];
          channelCache.set(cloudOrganizationId, next);
          return next;
        });
        const pending = pendingCreates.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingCreates.current.delete(message.requestId);
          pending.resolve(message.channel.id);
        }
      }
      if (
        message.type === "channelUpdated" &&
        message.workspaceId === cloudOrganizationId
      ) {
        setChannels((current) => {
          const next = current.map((channel) =>
            channel.id === message.channel.id ? message.channel : channel,
          );
          channelCache.set(cloudOrganizationId, next);
          return next;
        });
        const pending = pendingUpdates.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingUpdates.current.delete(message.requestId);
          pending.resolve();
        }
      }
      if (
        message.type === "channelUpdateFailed" &&
        message.workspaceId === cloudOrganizationId
      ) {
        const pending = pendingUpdates.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingUpdates.current.delete(message.requestId);
          pending.reject(new Error(message.message));
        }
      }
      if (
        message.type === "channelPolicyUpdated" &&
        message.workspaceId === cloudOrganizationId
      ) {
        setChannels((current) => {
          const next = current.map((channel) =>
            channel.id === message.channel.id ? message.channel : channel,
          );
          channelCache.set(cloudOrganizationId, next);
          return next;
        });
        const pending = pendingPolicies.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingPolicies.current.delete(message.requestId);
          pending.resolve();
        }
      }
      if (
        message.type === "channelPolicyUpdateFailed" &&
        message.workspaceId === cloudOrganizationId
      ) {
        const pending = pendingPolicies.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingPolicies.current.delete(message.requestId);
          pending.reject(new Error(message.message));
        }
      }
      if (
        message.type === "channelDeleted" &&
        message.workspaceId === cloudOrganizationId
      ) {
        setChannels((current) => {
          const next = current.filter(
            (channel) => channel.id !== message.channelId,
          );
          channelCache.set(cloudOrganizationId, next);
          return next;
        });
        const pending = pendingDeletes.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingDeletes.current.delete(message.requestId);
          pending.resolve();
        }
      }
      if (
        message.type === "channelDeleteFailed" &&
        message.workspaceId === cloudOrganizationId
      ) {
        const pending = pendingDeletes.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingDeletes.current.delete(message.requestId);
          pending.reject(new Error(message.message));
        }
      }
    });
    client.send({
      type: "listChannels",
      workspaceId: cloudOrganizationId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status]);

  const createChannel = useCallback(
    (name: string, description?: string): Promise<string | null> => {
      if (!cloudOrganizationId || !capability) return Promise.resolve(null);
      const requestId = crypto.randomUUID();
      return new Promise((resolve) => {
        const timeout = window.setTimeout(() => {
          pendingCreates.current.delete(requestId);
          resolve(null);
          toast.error("Chief couldn't create that channel. Please try again.");
        }, 8_000);
        pendingCreates.current.set(requestId, { resolve, timeout });
        client.send({
          type: "createChannel",
          requestId,
          workspaceId: cloudOrganizationId,
          name,
          description,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId],
  );

  const updateChannelAgents = useCallback(
    (channelId: string, agentIds: string[]) => {
      if (!cloudOrganizationId || !capability) return;
      setChannels((current) => {
        const next = current.map((channel) =>
          channel.id === channelId
            ? { ...channel, agentIds, updatedAt: Date.now() }
            : channel,
        );
        channelCache.set(cloudOrganizationId, next);
        return next;
      });
      client.send({
        type: "updateChannelAgents",
        workspaceId: cloudOrganizationId,
        channelId,
        agentIds,
        executorCapability: capability,
      });
    },
    [capability, client, cloudOrganizationId],
  );

  const updateChannel = useCallback(
    (
      channelId: string,
      input: { name: string; topic: string; description: string },
    ): Promise<void> => {
      if (!cloudOrganizationId || !capability || !sessionToken) {
        return Promise.reject(
          new Error("Chief is still authorizing this workspace."),
        );
      }
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingUpdates.current.delete(requestId);
          reject(
            new Error("Chief couldn't update that channel. Please try again."),
          );
        }, 8_000);
        pendingUpdates.current.set(requestId, { reject, resolve, timeout });
        client.send({
          type: "updateChannel",
          requestId,
          workspaceId: cloudOrganizationId,
          channelId,
          name: input.name,
          topic: input.topic,
          description: input.description,
          sessionToken,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId, sessionToken],
  );

  const deleteChannel = useCallback(
    (channelId: string): Promise<void> => {
      if (!cloudOrganizationId || !capability || !sessionToken) {
        return Promise.reject(
          new Error("Chief is still connecting to this workspace."),
        );
      }
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingDeletes.current.delete(requestId);
          reject(
            new Error("Chief couldn't delete that channel. Please try again."),
          );
        }, 8_000);
        pendingDeletes.current.set(requestId, { reject, resolve, timeout });
        client.send({
          type: "deleteChannel",
          requestId,
          workspaceId: cloudOrganizationId,
          channelId,
          sessionToken,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId, sessionToken],
  );

  const setChannelPolicy = useCallback(
    (
      channelId: string,
      agentPermissions: WorkspaceChannel["agentPermissions"],
    ): Promise<void> => {
      if (!cloudOrganizationId || !capability || !sessionToken) {
        return Promise.reject(
          new Error("Chief is still authorizing this workspace."),
        );
      }
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingPolicies.current.delete(requestId);
          reject(
            new Error("Chief couldn't update agent access. Please try again."),
          );
        }, 8_000);
        pendingPolicies.current.set(requestId, { reject, resolve, timeout });
        client.send({
          type: "setChannelPolicy",
          requestId,
          workspaceId: cloudOrganizationId,
          channelId,
          agentPermissions,
          sessionToken,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId, sessionToken],
  );

  const setChannelArchived = useCallback(
    (channelId: string, archived: boolean): Promise<void> => {
      if (!cloudOrganizationId || !capability || !sessionToken) {
        return Promise.reject(
          new Error("Chief is still authorizing this workspace."),
        );
      }
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingUpdates.current.delete(requestId);
          reject(
            new Error("Chief couldn't update that channel. Please try again."),
          );
        }, 8_000);
        pendingUpdates.current.set(requestId, { reject, resolve, timeout });
        client.send({
          type: "setChannelArchived",
          requestId,
          workspaceId: cloudOrganizationId,
          channelId,
          archived,
          sessionToken,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId, sessionToken],
  );

  return {
    channels,
    createChannel,
    deleteChannel,
    setChannelArchived,
    setChannelPolicy,
    updateChannel,
    updateChannelAgents,
  };
}

export function reactionIntentKey(messageId: string, emoji: string) {
  return `${messageId}\0${emoji}`;
}
