import { useMemo } from "react";

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
  return useMemo(
    () => relayRuntimeTransport(client, snapshot, error),
    [client, error, snapshot],
  );
}
