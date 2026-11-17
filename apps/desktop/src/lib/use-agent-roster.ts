import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RelayClient, WorkspaceSubscription } from "@chief/relay-client";
import type { OwnedAgent, OwnedAgentRequest } from "@chief/relay-contracts";

export interface AgentRoster {
  client: RelayClient | null;
  agents: readonly OwnedAgent[];
  /** Requests still open; one leaves the moment it expires. */
  requests: readonly OwnedAgentRequest[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * A workspace's connected agents and join requests, kept current by the relay's
 * `workspace.agents.changed` signal instead of polling. The roster is
 * read once on open, again on each signal, and once after the socket returns
 * from a gap in which a signal could have been lost.
 */
export function useAgentRoster(
  client: RelayClient | null,
  enabled = true,
): AgentRoster {
  // Kept with the client it came from, so another workspace's agents never
  // linger while this one loads.
  const [loaded, setLoaded] = useState<{
    client: RelayClient;
    agents: OwnedAgent[];
    requests: OwnedAgentRequest[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reading = useRef<{
    client: RelayClient;
    requested: number;
    current: Promise<void>;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !enabled) return;
    // Signals that arrive mid-read fold into one more read, never a pile-up.
    const active = reading.current;
    if (active?.client === client) {
      active.requested += 1;
      return await active.current;
    }
    const read = async () => {
      try {
        const [connected, pending] = await Promise.all([
          client.ownedAgents(),
          client.ownedAgentRequests(),
        ]);
        setLoaded({
          client,
          agents: connected.agents,
          requests: pending.requests,
        });
        setError(null);
      } catch (cause) {
        // The last roster stays on screen; the next signal or reconnect retries.
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    const entry = { client, requested: 1, current: Promise.resolve() };
    reading.current = entry;
    entry.current = (async () => {
      let handled = 0;
      while (handled < entry.requested) {
        handled = entry.requested;
        await read();
      }
      if (reading.current === entry) reading.current = null;
    })();
    await entry.current;
  }, [client, enabled]);

  useEffect(() => {
    if (!client || !enabled) return;
    let stopped = false;
    let subscription: WorkspaceSubscription | null = null;
    void refresh();
    const listen = async () => {
      try {
        const opened = await client.subscribeWorkspace({
          conversationIds: [],
          onEvent: () => undefined,
          onAgentsChanged: () => void refresh(),
          onResubscribed: () => void refresh(),
        });
        if (stopped) opened.close();
        else subscription = opened;
      } catch (cause) {
        if (!stopped)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void listen();
    return () => {
      stopped = true;
      subscription?.close();
    };
  }, [client, enabled, refresh]);

  const current = loaded?.client === client ? loaded : null;
  const agents = current?.agents ?? noAgents;
  const requests = useOpenRequests(current?.requests);
  const loading = Boolean(client) && enabled && current === null;
  return useMemo(
    () => ({ client, agents, requests, loading, error, refresh }),
    [client, agents, requests, loading, error, refresh],
  );
}

const noAgents: readonly OwnedAgent[] = [];

const none: readonly OwnedAgentRequest[] = [];

/** Drops requests as they expire, on a local timer rather than a re-read. */
function useOpenRequests(requests: readonly OwnedAgentRequest[] | undefined) {
  const [now, setNow] = useState(() => Date.now());
  const list = requests ?? none;
  const next = Math.min(
    ...list
      .map((request) => Date.parse(request.expiresAt))
      .filter((expiry) => expiry > now),
  );
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, next - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [next]);
  return useMemo(
    () => list.filter((request) => Date.parse(request.expiresAt) > now),
    [list, now],
  );
}
