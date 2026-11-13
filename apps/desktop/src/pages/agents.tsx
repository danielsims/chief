import { useEffect, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { useSearchParams } from "react-router";

import type { DriverType } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import { relayRuntimeIdentity } from "../components/agents/agent-connection-model";
import { AgentDetail } from "../components/agents/agent-detail";
import { ConnectAgentDialog } from "../components/agents/connect-agent-dialog";
import { OwnedAgentDetail } from "../components/agents/owned-agent-detail";
import {
  AgentJoinRequests,
  CopyInvitePromptButton,
  useOwnedAgents,
} from "../components/agents/owned-agents-panel";
import { OwnedAgentAppearance } from "../components/chat/owned-agent-context";
import { listColumnClass } from "../components/list-row";
import { PageHeader } from "../components/page-header";
import { executionPreferencesForTeam } from "../lib/agent-execution-preferences";
import { agentListEntries } from "../lib/agent-settings-profile";
import { useAuth } from "../lib/auth/auth-context";
import { CHIEF_CLOUD_RELAY_URL, RELAY_URL } from "../lib/config";
import {
  ownedAgentDefinition,
  workspaceAgentHandle,
} from "../lib/owned-agent-presentation";
import { useRelaySession } from "../lib/relay-session";
import {
  useAgentPreferences,
  useRuntime,
  useWorkspaceChannels,
} from "../lib/runtime";
import { provisionEveAgent } from "../lib/vercel-eve-runtime";
import { TeamAgentRow } from "./agents-components";

export function AgentsPage() {
  const relay = useRelaySession();
  const ownedAgents = useOwnedAgents(relay.client);
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    if (!relay.client) return;
    let stopped = false;
    relay.client
      .accountProfile()
      .then((profile) => {
        if (!stopped) setUsername(profile.username);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [relay.client]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { agents, agentsLoaded, createNativeAgent, removeAgent } = useRuntime();
  const { cloudOrganizationId } = useAuth();
  const agentPreferences = useAgentPreferences(cloudOrganizationId);
  const workspaceChannels = useWorkspaceChannels();
  const overrides = agentPreferences.preferences;
  const ready = Boolean(cloudOrganizationId) && !agentPreferences.loading;
  const agentId = searchParams.get("agent");
  const profileId = searchParams.get("profile");
  const requestedFilter = searchParams.get("location");
  const filter =
    requestedFilter === "local" || requestedFilter === "cloud"
      ? requestedFilter
      : "all";
  const entries = agentListEntries(agents, overrides).filter(
    (entry) => filter === "all" || entry.location === filter,
  );
  const resolvedAgent = agents.find((agent) => agent.id === agentId);
  const resolvedParent =
    resolvedAgent ??
    agents.find((agent) =>
      agent.subagents?.some((subagent) => subagent.id === agentId),
    );
  const [retainedAgent, setRetainedAgent] = useState<{
    agent: (typeof agents)[number];
    agentId: string;
    workspaceId: string | null;
  } | null>(null);
  if (resolvedParent && agentId) {
    if (
      retainedAgent?.agentId !== agentId ||
      retainedAgent.agent !== resolvedParent ||
      retainedAgent.workspaceId !== cloudOrganizationId
    ) {
      setRetainedAgent({
        agent: resolvedParent,
        agentId,
        workspaceId: cloudOrganizationId,
      });
    }
  } else if (!agentId && retainedAgent !== null) {
    setRetainedAgent(null);
  } else if (
    cloudOrganizationId &&
    retainedAgent?.workspaceId &&
    retainedAgent.workspaceId !== cloudOrganizationId
  ) {
    setRetainedAgent(null);
  }
  const selectedAgent =
    resolvedParent ??
    (retainedAgent?.agentId === agentId ? retainedAgent.agent : undefined);
  const selectedOwned = selectedAgent
    ? undefined
    : ownedAgents.agents.find((agent) => agent.id === agentId);
  const detailMode = selectedAgent !== undefined || selectedOwned !== undefined;
  const openAgent = (rootId: string, profile?: string) =>
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set("agent", rootId);
      if (profile && profile !== rootId) params.set("profile", profile);
      else params.delete("profile");
      return params;
    });
  const closeDetail = () => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.delete("agent");
      params.delete("profile");
      return params;
    });
  };
  const applyExecutionToTeam = (
    deploymentTarget: "phone" | "desktop" | "cloud",
    driver: DriverType,
    model?: string,
  ) => {
    if (!selectedAgent) return;
    for (const preference of executionPreferencesForTeam(
      selectedAgent,
      overrides,
      deploymentTarget,
      driver,
      model,
    )) {
      agentPreferences.save(preference);
    }
  };
  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      {!detailMode ? (
        <PageHeader
          title="Agents"
          description="See who is available, what they can access, and where they are working."
          actions={
            <>
              <CopyInvitePromptButton client={relay.client} />
              <Button size="sm" onClick={() => setConnectOpen(true)}>
                <Plus size={14} />
                Add agent
              </Button>
            </>
          }
        />
      ) : null}

      <OwnedAgentAppearance agents={ownedAgents.agents}>
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto">
            {selectedOwned ? (
              <section className="mx-auto w-full max-w-6xl p-6">
                <nav className="text-muted-foreground mb-4 flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={closeDetail}
                    className="hover:text-foreground rounded-md px-1 py-1 transition-colors"
                  >
                    Agents
                  </button>
                  <ChevronRight size={11} />
                  <span className="text-foreground font-medium">
                    {ownedAgentDefinition(selectedOwned).name}
                  </span>
                </nav>
                <OwnedAgentDetail
                  key={selectedOwned.id}
                  agent={selectedOwned}
                  state={ownedAgents}
                  workspaceId={cloudOrganizationId}
                  channels={workspaceChannels.channels}
                  ready={ready}
                  onClose={closeDetail}
                />
              </section>
            ) : selectedAgent ? (
              <section className="mx-auto w-full max-w-6xl p-6">
                <nav className="text-muted-foreground mb-4 flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={closeDetail}
                    className="hover:text-foreground rounded-md px-1 py-1 transition-colors"
                  >
                    Agents
                  </button>
                  <ChevronRight size={11} />
                  <span className="text-foreground font-medium">
                    {selectedAgent.name}
                  </span>
                </nav>
                <AgentDetail
                  key={selectedAgent.id}
                  agent={selectedAgent}
                  selectedProfileId={
                    profileId &&
                    selectedAgent.subagents?.some(
                      (subagent) => subagent.id === profileId,
                    )
                      ? profileId
                      : agentId && agentId !== selectedAgent.id
                        ? agentId
                        : selectedAgent.id
                  }
                  onSelectProfile={(nextId) => {
                    setSearchParams((current) => {
                      const params = new URLSearchParams(current);
                      params.set("agent", selectedAgent.id);
                      if (nextId === selectedAgent.id) params.delete("profile");
                      else params.set("profile", nextId);
                      return params;
                    });
                  }}
                  workspaceId={cloudOrganizationId}
                  preferences={overrides}
                  channels={workspaceChannels.channels}
                  ready={ready}
                  saving={agentPreferences.saving}
                  preferenceError={agentPreferences.error}
                  relayClient={relay.client}
                  onAgentChanged={relay.refresh}
                  onSave={agentPreferences.save}
                  onApplyExecutionToTeam={applyExecutionToTeam}
                  onUpdateChannelAgents={workspaceChannels.updateChannelAgents}
                  onRemove={async (removedAgentId) => {
                    await removeAgent(removedAgentId);
                    closeDetail();
                  }}
                />
              </section>
            ) : (
              <section className="px-6 pb-6">
                <div className={listColumnClass}>
                  <div
                    className="mb-3 flex flex-wrap gap-1"
                    aria-label="Agent locations"
                  >
                    {(["all", "local", "cloud"] as const).map((location) => (
                      <button
                        key={location}
                        type="button"
                        aria-pressed={filter === location}
                        onClick={() =>
                          setSearchParams((current) => {
                            const params = new URLSearchParams(current);
                            if (location === "all") params.delete("location");
                            else params.set("location", location);
                            return params;
                          })
                        }
                        className={cn(
                          "text-muted-foreground hover:text-foreground h-7 cursor-pointer rounded-full px-3 text-[12px] capitalize transition-colors",
                          filter === location &&
                            "bg-foreground/[0.06] text-foreground",
                        )}
                      >
                        {location}
                      </button>
                    ))}
                  </div>
                  <ul>
                    {entries.map(({ rootId, agent, preference }) => (
                      <TeamAgentRow
                        key={agent.id}
                        agent={agent}
                        handle={workspaceAgentHandle(username, agent.name)}
                        override={preference}
                        onSelect={() => openAgent(rootId, agent.id)}
                      />
                    ))}
                    {filter === "all"
                      ? ownedAgents.agents.map((owned) => (
                          <TeamAgentRow
                            key={owned.id}
                            agent={ownedAgentDefinition(owned)}
                            handle={owned.handle}
                            override={undefined}
                            status={{
                              on: owned.online,
                              label: owned.online ? "Online" : "Offline",
                            }}
                            onSelect={() => openAgent(owned.id)}
                          />
                        ))
                      : null}
                  </ul>
                  {filter !== "all" && ownedAgents.agents.length > 0 ? (
                    <p className="text-muted-foreground mt-3 text-xs">
                      Externally managed agents appear under All.
                    </p>
                  ) : null}
                  {agentsLoaded &&
                  ready &&
                  entries.length === 0 &&
                  (filter !== "all" ||
                    (!ownedAgents.loading &&
                      ownedAgents.agents.length === 0)) ? (
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
                      <p className="text-sm font-medium">
                        {filter === "all"
                          ? "No agents yet"
                          : `No ${filter} agents`}
                      </p>
                      <p className="text-muted-foreground mt-1 max-w-sm text-[13px] leading-5">
                        {filter === "all"
                          ? "Add an agent when you are ready. This workspace can stay empty."
                          : "Choose another filter or add an agent to get started."}
                      </p>
                      <Button
                        className="mt-4"
                        size="sm"
                        onClick={() => setConnectOpen(true)}
                      >
                        <Plus size={14} />
                        Add agent
                      </Button>
                    </div>
                  ) : null}
                  <AgentJoinRequests state={ownedAgents} />
                </div>
                {!ready ? (
                  <p className="text-muted-foreground mt-4 text-xs">
                    Connecting to your workspace…
                  </p>
                ) : null}
              </section>
            )}
          </main>
        </div>
      </OwnedAgentAppearance>
      <ConnectAgentDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        client={relay.client}
        relayIdentity={relayRuntimeIdentity(RELAY_URL, CHIEF_CLOUD_RELAY_URL)}
        listVercelEveDestinations={async (teamId) => {
          if (!relay.client) {
            throw new Error("Chief is still connecting to this workspace.");
          }
          return await relay.client.listVercelDestinations(teamId);
        }}
        connectVercel={async (token) => {
          if (!relay.client) {
            throw new Error("Chief is still connecting to this workspace.");
          }
          return await relay.client.connectVercel(token);
        }}
        onConnected={relay.refresh}
        onCreateNative={async (input, preference) => {
          await createNativeAgent(input, preference);
        }}
        onProvisionEve={async (input, onProgress) => {
          if (!relay.client) {
            throw new Error("Chief is still connecting to this workspace.");
          }
          return await provisionEveAgent({
            client: relay.client,
            input,
            onProgress,
          });
        }}
      />
    </div>
  );
}
