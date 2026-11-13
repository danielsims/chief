import type { ReactNode } from "react";
import { useContext, useEffect, useMemo, useState } from "react";

import type { OwnedAgent } from "@chief/relay-contracts";

import type { AgentAppearance, ProviderMark } from "../agent-avatar";
import { notifyAgentJoinRequests } from "../../lib/agent-join-notifications";
import { ownedAgentLabel } from "../../lib/owned-agent-presentation";
import { useRelaySession } from "../../lib/relay-session";
import { agentBrand, ProviderIcon } from "../../pages/onboarding/elements";
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
        const [value, pending] = await Promise.all([
          client.ownedAgents(),
          client.ownedAgentRequests().catch(() => ({ requests: [] })),
        ]);
        if (!stopped) {
          setResult({ client, agents: value.agents });
          notifyAgentJoinRequests(
            client.workspaceId ?? "workspace",
            pending.requests,
          );
        }
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
  const value = useMemo(
    () => withOwnedAgents(appearance, agents),
    [agents, appearance],
  );
  return (
    <OwnedAgentsContext.Provider value={agents}>
      <AgentAppearanceContext.Provider value={value}>
        {children}
      </AgentAppearanceContext.Provider>
    </OwnedAgentsContext.Provider>
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
      });
    }
    if (agent.handle) agentIds.set(agent.handle.toLowerCase(), agent.id);
    agentIds.set(ownedAgentLabel(agent).toLowerCase(), agent.id);
  }
  return { ...appearance, avatars, providerMarks, agentIds };
}

/** Draws owned agents from a roster fresher than the app-wide poll, such as
 * the Agents page's right after an approval or avatar change. */
export function OwnedAgentAppearance({
  agents,
  children,
}: {
  agents: readonly OwnedAgent[];
  children: ReactNode;
}) {
  const appearance = useContext(AgentAppearanceContext);
  const value = useMemo(
    () => withOwnedAgents(appearance, agents),
    [agents, appearance],
  );
  return (
    <AgentAppearanceContext.Provider value={value}>
      {children}
    </AgentAppearanceContext.Provider>
  );
}
