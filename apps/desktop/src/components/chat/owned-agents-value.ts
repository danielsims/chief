import { createContext, useContext } from "react";

import type { OwnedAgent } from "@chief/relay-contracts";

/** Kept apart from the provider so chat code can read the roster without
 * loading provider artwork. */
export const OwnedAgentsContext = createContext<readonly OwnedAgent[]>([]);

export function useOwnedAgents() {
  return useContext(OwnedAgentsContext);
}
