import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { useSearchParams } from "react-router";

import type { DriverType } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import type { AgentIntegrationOption } from "../components/agents/agent-detail";
import { relayRuntimeIdentity } from "../components/agents/agent-connection-model";
import { AgentDetail } from "../components/agents/agent-detail";
import { ConnectAgentDialog } from "../components/agents/connect-agent-dialog";
import { PageTitle } from "../components/page-title";
import { executionPreferencesForTeam } from "../lib/agent-execution-preferences";
import { useAuth } from "../lib/auth/auth-context";
import { CHIEF_CLOUD_RELAY_URL, RELAY_URL } from "../lib/config";
import { useLocalIntegrationStatus } from "../lib/local-integration-status";
import { useRelaySession } from "../lib/relay-session";
import {
  useAgentPreferences,
  useRuntime,
  useWorkspaceChannels,
} from "../lib/runtime";
import { TeamAgentCard } from "./agents-components";

export function AgentsPage() {
  const relay = useRelaySession();
  const [connectOpen, setConnectOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { agents, agentsLoaded, createNativeAgent, removeAgent } = useRuntime();
  const { cloudOrganizationId } = useAuth();
  const { integrations: localIntegrations } = useLocalIntegrationStatus();
  const integrations: AgentIntegrationOption[] = (localIntegrations ?? [])
    .filter((integration) => integration.status === "connected")
    .map((integration) => ({
      provider: integration.provider,
      displayName: integration.displayName ?? integration.provider,
    }));
  const agentPreferences = useAgentPreferences(cloudOrganizationId);
  const workspaceChannels = useWorkspaceChannels();
  const overrides = agentPreferences.preferences;
  const ready = Boolean(cloudOrganizationId) && !agentPreferences.loading;
  const agentId = searchParams.get("agent");
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const detailMode = selectedAgent !== undefined;
  const closeDetail = () => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.delete("agent");
      return params;
    });
  };
  const applyExecutionToTeam = (
    deploymentTarget: "phone" | "desktop" | "cloud",
    driver: DriverType,
    model?: string,
  ) => {
    for (const preference of executionPreferencesForTeam(
      agents,
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
        <header className="shrink-0 px-6 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <PageTitle>Agents</PageTitle>
              <p className="text-muted-foreground mt-1 text-[13px]">
                See who is available, what they can access, and where they are
                working.
              </p>
            </div>
            <Button size="sm" onClick={() => setConnectOpen(true)}>
              <Plus size={14} />
              Add agent
            </Button>
          </div>
        </header>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          {selectedAgent ? (
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
                workspaceId={cloudOrganizationId}
                override={overrides.find(
                  (item) => item.agentId === selectedAgent.id,
                )}
                integrations={integrations}
                channels={workspaceChannels.channels}
                ready={ready}
                saving={agentPreferences.saving}
                preferenceError={agentPreferences.error}
                externalAgentClient={relay.client?.externalAgents ?? null}
                onExternalAgentChanged={relay.refresh}
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
            <section className="p-6">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(238px,1fr))] gap-3">
                {agents.map((agent) => (
                  <TeamAgentCard
                    key={agent.id}
                    agent={agent}
                    override={overrides.find(
                      (entry) => entry.agentId === agent.id,
                    )}
                    selected={false}
                    onSelect={() => {
                      setSearchParams((current) => {
                        const params = new URLSearchParams(current);
                        params.set("agent", agent.id);
                        return params;
                      });
                    }}
                  />
                ))}
              </div>
              {agentsLoaded && agents.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
                  <p className="text-sm font-medium">No agents yet</p>
                  <p className="text-muted-foreground mt-1 max-w-sm text-[13px] leading-5">
                    Add an agent when you are ready. This workspace can stay
                    empty.
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
              {!ready ? (
                <p className="text-muted-foreground mt-4 text-xs">
                  Connecting to your workspace…
                </p>
              ) : null}
            </section>
          )}
        </main>
      </div>
      <ConnectAgentDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        client={relay.client}
        relayIdentity={relayRuntimeIdentity(RELAY_URL, CHIEF_CLOUD_RELAY_URL)}
        integrations={integrations}
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
          await createNativeAgent(input);
          agentPreferences.save(preference);
        }}
        onProvisionEve={async (input, onProgress) => {
          if (!relay.client) {
            throw new Error("Chief is still connecting to this workspace.");
          }
          onProgress?.({ phase: "validating" });
          const result = await relay.client.provisionVercelEve(input);
          onProgress?.({ phase: "checking", ...result });
          return result;
        }}
      />
    </div>
  );
}
