import type { InputRequest, SessionState } from "eve/client";

import {
  isJsonNumber,
  isJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

export interface RemoteDriverState {
  version: 1;
  host: string;
  session: SessionState;
  inFlight: boolean;
  awaitingInput: boolean;
  activeTurnId?: string;
  pendingRequests?: InputRequest[];
  turnStartedAt?: number;
  costUsd?: number;
}

export function savedRemoteDriverState(
  value: unknown,
  host: string,
): RemoteDriverState | undefined {
  if (!value || !isJsonObject(value)) return undefined;
  const state = value as Partial<RemoteDriverState>;
  if (
    state.version !== 1 ||
    state.host !== host ||
    !state.session ||
    !isJsonNumber(state.session.streamIndex)
  ) {
    return undefined;
  }
  return {
    version: 1,
    host,
    session: state.session,
    inFlight: state.inFlight === true,
    awaitingInput: state.awaitingInput === true,
    activeTurnId: state.activeTurnId,
    pendingRequests: state.pendingRequests,
    turnStartedAt: state.turnStartedAt,
    costUsd: state.costUsd,
  };
}

interface RemoteAction {
  kind: string;
  toolName?: string;
  subagentName?: string;
  remoteAgentName?: string;
}

export function remoteActionName(action: RemoteAction) {
  const name =
    action.toolName ??
    action.subagentName ??
    action.remoteAgentName ??
    "load_skill";
  return name.replace(/^executor__/, "");
}

export const remoteResultOutput = (result: { output?: unknown }) =>
  parseJsonValue(result.output) ?? null;
