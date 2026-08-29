import type { InputRequest, SessionState } from "eve/client";

import {
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
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

export function savedRemoteDriverState<TState>(
  value: TState,
  host: string,
): RemoteDriverState | undefined {
  if (!value || !isJsonObject(value)) return undefined;
  const state = value;
  const session = state.session;
  if (
    state.version !== 1 ||
    state.host !== host ||
    !isJsonObject(session) ||
    !isJsonNumber(session.streamIndex)
  ) {
    return undefined;
  }
  const parsedSession: SessionState = {
    streamIndex: session.streamIndex,
    continuationToken: isJsonString(session.continuationToken)
      ? session.continuationToken
      : undefined,
    sessionId: isJsonString(session.sessionId) ? session.sessionId : undefined,
  };
  return {
    version: 1,
    host,
    session: parsedSession,
    inFlight: isJsonBoolean(state.inFlight) && state.inFlight,
    awaitingInput: isJsonBoolean(state.awaitingInput) && state.awaitingInput,
    activeTurnId: isJsonString(state.activeTurnId)
      ? state.activeTurnId
      : undefined,
    turnStartedAt: isJsonNumber(state.turnStartedAt)
      ? state.turnStartedAt
      : undefined,
    costUsd: isJsonNumber(state.costUsd) ? state.costUsd : undefined,
  };
}

interface RemoteAction {
  kind: string;
  toolName?: string;
  subagentName?: string;
  remoteAgentName?: string;
}

export function remoteActionName(action: RemoteAction): string {
  const name =
    action.toolName ??
    action.subagentName ??
    action.remoteAgentName ??
    "load_skill";
  return name.replace(/^executor__/, "");
}

export const remoteResultOutput = (result: { output?: unknown }) =>
  parseJsonValue(result.output) ?? null;
