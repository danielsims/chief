import type { ReactNode } from "react";
import { useContext, useEffect, useMemo, useState } from "react";

import type { OwnedAgent } from "@chief/relay-contracts";

import type { ProviderMark } from "../agent-avatar";
import { agentName } from "../../lib/owned-agent-presentation";
import { useRelaySession } from "../../lib/relay-session";
import { ProviderIcon } from "../../pages/onboarding/elements";
import { AgentAppearanceContext } from "../agent-avatar";
import { OwnedAgentsContext } from "./owned-agents-value";

export function OwnedAgentProvider({ children }: { children: ReactNode }) {
  const { client } = useRelaySession();
  const appearance = useContext(AgentAppearanceContext);
  const [result, setResult] = useState<{
    client: typeof client;
    agents: OwnedAgent[];
  }>({ client: null, agents: [] });
  useEffect(() => {
    if (!client) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const value = await client.ownedAgents();
        if (!stopped) setResult({ client, agents: value.agents });
      } catch {
        /* Keep the last roster during a transient reconnect. */
      } finally {
        if (!stopped) timer = setTimeout(() => void refresh(), 10000);
      }
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [client]);
  const agents = useMemo(
    () => (result.client === client ? result.agents : []),
    [client, result],
  );
  const value = useMemo(() => {
    const providerMarks = new Map(appearance.providerMarks);
    const agentIds = new Map(appearance.agentIds);
    for (const agent of agents) {
      const Mark: ProviderMark["Mark"] = ({ className }) => (
        <ProviderIcon provider={agent.provider} className={className} />
      );
      providerMarks.set(agent.id, {
        Mark,
        tileClassName: "bg-[#f4f4f4] text-[#171717]",
      });
      if (agent.handle) agentIds.set(agent.handle.toLowerCase(), agent.id);
      agentIds.set(
        agentName(agent.provider, agent.name).toLowerCase(),
        agent.id,
      );
    }
    return { ...appearance, providerMarks, agentIds };
  }, [agents, appearance]);
  return (
    <OwnedAgentsContext.Provider value={agents}>
      <AgentAppearanceContext.Provider value={value}>
        {children}
      </AgentAppearanceContext.Provider>
    </OwnedAgentsContext.Provider>
  );
}
