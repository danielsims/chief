import { createContext, useContext } from "react";

import type { RelaySessionValue } from "./relay-session-value";

export const RelaySessionContext = createContext<RelaySessionValue | null>(
  null,
);

export function useRelaySession() {
  const value = useContext(RelaySessionContext);
  if (!value) {
    throw new Error("useRelaySession must be used inside RelaySessionProvider");
  }
  return value;
}
