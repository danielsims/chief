import { useEffect, useState } from "react";

import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";

import type { RuntimeTransport } from "./runtime-transport";
import { PendingRelayRuntimeClient } from "./pending-relay-runtime-client";
import { RelayRuntimeClient } from "./relay-runtime-client";

export function relayRuntimeTransport(
  client: RelayClient | null,
  snapshot: WorkspaceSnapshot | null,
  error: string | null,
): RuntimeTransport {
  return client && snapshot
    ? new RelayRuntimeClient(client, snapshot)
    : new PendingRelayRuntimeClient(error);
}

export function useRelayRuntimeTransport({
  client,
  snapshot,
  error,
}: {
  client: RelayClient | null;
  snapshot: WorkspaceSnapshot | null;
  error: string | null;
}) {
  const workspaceId = snapshot?.id ?? null;
  const pendingError = client && snapshot ? null : error;
  const [state, setState] = useState(() => ({
    client,
    workspaceId,
    pendingError,
    transport: relayRuntimeTransport(client, snapshot, error),
  }));
  if (
    state.client !== client ||
    state.workspaceId !== workspaceId ||
    state.pendingError !== pendingError
  ) {
    setState({
      client,
      workspaceId,
      pendingError,
      transport: relayRuntimeTransport(client, snapshot, error),
    });
  }
  useEffect(() => {
    if (snapshot && state.transport instanceof RelayRuntimeClient) {
      state.transport.updateSnapshot(snapshot);
    }
  }, [snapshot, state.transport]);
  return state.transport;
}
