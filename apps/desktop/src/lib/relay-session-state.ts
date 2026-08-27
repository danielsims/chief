import type { RelayClient } from "@chief/relay-client";
import type {
  WorkspaceSnapshot,
  WorkspaceSummary,
} from "@chief/relay-contracts";

import { RELAY_URL } from "./config";
import { knownWorkspaceSummaries } from "./relay-connection";

export interface RelaySessionState {
  accountId: string | null;
  client: RelayClient | null;
  snapshot: WorkspaceSnapshot | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  error: string | null;
}

export function initialRelaySessionState(
  accountId: string | null,
  sessionToken: string | null,
): RelaySessionState {
  return {
    accountId,
    client: null,
    snapshot: null,
    workspaces: knownWorkspaceSummaries(RELAY_URL, accountId),
    loading: Boolean(sessionToken),
    error: null,
  };
}

export function visibleRelaySessionState(
  state: RelaySessionState,
  accountId: string | null,
  sessionToken: string | null,
): RelaySessionState {
  return state.accountId === accountId
    ? state
    : initialRelaySessionState(accountId, sessionToken);
}
