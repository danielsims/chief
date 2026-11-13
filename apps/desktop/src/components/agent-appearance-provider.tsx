import type { ReactNode } from "react";
import { useMemo } from "react";

import { useRelaySession } from "../lib/relay-session";
import { useRuntime } from "../lib/runtime";
import { agentAppearance } from "./agent-appearance";
import { AgentAppearanceContext } from "./agent-avatar";

/** Supplies every agent's avatar from the live roster, with provider logos for
 * on-device agents that have none. It follows the runtime's roster, which
 * changes as soon as an agent is created or reconfigured. */
export function AgentAppearanceProvider({ children }: { children: ReactNode }) {
  const { agents } = useRuntime();
  const { snapshot } = useRelaySession();
  const value = useMemo(() => {
    const profiles = [
      ...(snapshot?.agents ?? []).flatMap((agent) => [
        agent,
        ...agent.subagents,
      ]),
      ...agents.flatMap((agent) => [agent, ...(agent.subagents ?? [])]),
    ];
    return agentAppearance(profiles);
  }, [agents, snapshot?.agents]);
  return (
    <AgentAppearanceContext.Provider value={value}>
      {children}
    </AgentAppearanceContext.Provider>
  );
}
