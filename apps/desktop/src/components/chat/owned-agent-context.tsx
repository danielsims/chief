import type { ReactNode } from "react";
import { useContext, useEffect, useMemo } from "react";

import type { OwnedAgent } from "@chief/relay-contracts";

import type { AgentAppearance, ProviderMark } from "../agent-avatar";
import { notifyAgentJoinRequests } from "../../lib/agent-join-notifications";
import { ownedAgentLabel } from "../../lib/owned-agent-presentation";
import { useRelaySession } from "../../lib/relay-session";
import { useAgentRoster } from "../../lib/use-agent-roster";
import { agentBrand, ProviderIcon } from "../../pages/onboarding/elements";
import { AgentAppearanceContext } from "../agent-avatar";
import { providerBrandColors } from "../agent-color";
import { AgentRosterContext, OwnedAgentsContext } from "./owned-agents-value";

export function OwnedAgentProvider({ children }: { children: ReactNode }) {
  const { client } = useRelaySession();
  const appearance = useContext(AgentAppearanceContext);
  const roster = useAgentRoster(client);
  const { agents, requests } = roster;
  useEffect(() => {
    if (client)
      notifyAgentJoinRequests(client.workspaceId ?? "workspace", requests);
  }, [client, requests]);
  const value = useMemo(
    () => withOwnedAgents(appearance, agents),
    [agents, appearance],
  );
  return (
    <AgentRosterContext.Provider value={roster}>
      <OwnedAgentsContext.Provider value={agents}>
        <AgentAppearanceContext.Provider value={value}>
          {children}
        </AgentAppearanceContext.Provider>
      </OwnedAgentsContext.Provider>
    </AgentRosterContext.Provider>
  );
}

/** How owned agents look: their own avatar, else their provider's logo. */
function withOwnedAgents(
  appearance: AgentAppearance,
  agents: readonly OwnedAgent[],
): AgentAppearance {
  const providerMarks = new Map(appearance.providerMarks);
  const agentIds = new Map(appearance.agentIds);
  const avatars = new Map(appearance.avatars);
  for (const agent of agents) {
    if (agent.avatar) avatars.set(agent.id, agent.avatar);
    else avatars.delete(agent.id);
    const brand = agentBrand(agent.provider, agent.name);
    if (brand) {
      const Mark: ProviderMark["Mark"] = ({ className }) => (
        <ProviderIcon provider={brand} className={className} />
      );
      providerMarks.set(agent.id, {
        Mark,
        tileClassName: "bg-[#f4f4f4] text-[#171717]",
        color: providerBrandColors[brand],
      });
    }
    if (agent.handle) agentIds.set(agent.handle.toLowerCase(), agent.id);
    agentIds.set(ownedAgentLabel(agent).toLowerCase(), agent.id);
  }
  return { ...appearance, avatars, providerMarks, agentIds };
}
