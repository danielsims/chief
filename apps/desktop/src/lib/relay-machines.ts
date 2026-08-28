import { useCallback, useEffect, useRef, useState } from "react";

import type { Machine, MachineUpdate } from "@chief/relay-contracts";

import { useRelaySession } from "./relay-session";

const cache = new Map<string, Machine[]>();

export function machineListIsLoading(
  workspaceId: string | undefined,
  hasCachedMachines: boolean,
  pending: boolean,
) {
  return Boolean(workspaceId && !hasCachedMachines && pending);
}

export function useRelayMachines() {
  const { client, loading: sessionLoading, snapshot } = useRelaySession();
  const workspaceId = snapshot?.id;
  const requestGeneration = useRef(0);
  const [machines, setMachines] = useState<Machine[]>(
    workspaceId ? (cache.get(workspaceId) ?? []) : [],
  );
  const [loading, setLoading] = useState(
    machineListIsLoading(
      workspaceId,
      Boolean(workspaceId && cache.has(workspaceId)),
      true,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !workspaceId || sessionLoading) return;
    const generation = ++requestGeneration.current;
    setLoading(true);
    try {
      const next = await client.listMachines();
      if (generation !== requestGeneration.current) return;
      cache.set(workspaceId, next);
      setMachines(next);
      setError(null);
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [client, sessionLoading, workspaceId]);

  useEffect(() => {
    if (!client || !workspaceId || sessionLoading) return;
    if (cache.has(workspaceId)) return;
    queueMicrotask(() => void refresh());
    return () => {
      requestGeneration.current += 1;
    };
  }, [client, refresh, sessionLoading, workspaceId]);

  const run = useCallback(
    async (operation: () => Promise<Machine>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await operation();
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return {
    machines: workspaceId ? (cache.get(workspaceId) ?? []) : machines,
    loading: machineListIsLoading(
      workspaceId,
      Boolean(workspaceId && cache.has(workspaceId)),
      sessionLoading || loading,
    ),
    busy,
    error,
    refresh,
    update: async (id: string, input: MachineUpdate) => {
      if (!client) throw new Error("The relay is not connected.");
      await run(() => client.updateMachine(id, input));
    },
  };
}
