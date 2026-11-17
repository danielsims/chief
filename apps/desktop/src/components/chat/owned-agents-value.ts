import { createContext, useContext } from "react";

import type { OwnedAgent } from "@chief/relay-contracts";

import type { AgentRoster } from "../../lib/use-agent-roster";

/** Kept apart from the provider so chat code can read the roster without
 * loading provider artwork. */
export const OwnedAgentsContext = createContext<readonly OwnedAgent[]>([]);

export function useOwnedAgents() {
  return useContext(OwnedAgentsContext);
}

const noRoster: AgentRoster = {
  client: null,
  agents: [],
  requests: [],
  loading: false,
  error: null,
  refresh: () => Promise.resolve(),
};

/** The active workspace's roster with its join requests, for managing them. */
export const AgentRosterContext = createContext<AgentRoster>(noRoster);

export function useAgentRosterContext() {
  return useContext(AgentRosterContext);
}
