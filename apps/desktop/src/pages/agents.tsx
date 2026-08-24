import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router";

import { defaultAgents } from "@chief/agent-runtime/agent-roster";
import { cn } from "@chief/ui/lib/utils";

import type { AgentIntegrationOption } from "../components/agents/agent-detail";
import { AgentDetail } from "../components/agents/agent-detail";
import { PageTitle } from "../components/page-title";
import { useAuth } from "../lib/auth/auth-context";
import { useLocalIntegrationStatus } from "../lib/local-integration-status";
import { PLAYBOOKS } from "../lib/playbook-catalog";
import {
  useAgentPreferences,
  useRuntime,
  useWorkspaceChannels,
} from "../lib/runtime";
import {
  AgentAvatar,
  AvailableAgentDetail,
  availableAgents,
  PlaybooksCatalogue,
  TeamAgentCard,
} from "./agents-components";

export function AgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { agents: runtimeAgents } = useRuntime();
  const { cloudOrganizationId } = useAuth();
  const { integrations: localIntegrations } = useLocalIntegrationStatus();
  const integrations: AgentIntegrationOption[] = (localIntegrations ?? [])
    .filter((integration) => integration.status === "connected")
    .map((integration) => ({
      provider: integration.provider,
      displayName: integration.displayName ?? integration.provider,
    }));
  const agents = runtimeAgents.length > 0 ? runtimeAgents : defaultAgents;
  const agentPreferences = useAgentPreferences(cloudOrganizationId);
  const workspaceChannels = useWorkspaceChannels();
  const overrides = agentPreferences.preferences;
  const ready = Boolean(cloudOrganizationId) && !agentPreferences.loading;
  const [view, setView] = useState<"installed" | "available" | "playbooks">(
    "installed",
  );
  const agentId = searchParams.get("agent");
  const libraryAgentId = searchParams.get("libraryAgent");
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const selectedAvailableAgent = availableAgents.find(
    (agent) => agent.id === libraryAgentId,
  );
  const activeView = selectedAgent
    ? "installed"
    : selectedAvailableAgent
      ? "available"
      : view;
  const activeAgentCount = agents.filter(
    (agent) =>
      overrides.find((entry) => entry.agentId === agent.id)?.enabled ?? true,
  ).length;
  const detailMode =
    selectedAgent !== undefined || selectedAvailableAgent !== undefined;

  const selectView = (next: "installed" | "available" | "playbooks") => {
    setView(next);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.delete("agent");
      params.delete("libraryAgent");
      return params;
    });
  };
  const closeDetail = () => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.delete("agent");
      params.delete("libraryAgent");
      return params;
    });
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
          </div>

          <div className="mt-5 flex items-end justify-between gap-4">
            <nav className="flex items-center gap-5" aria-label="Agent views">
              {(
                [
                  ["installed", "Team", agents.length],
                  ["available", "Library", availableAgents.length],
                  ["playbooks", "Playbooks", PLAYBOOKS.length],
                ] as const
              ).map(([key, label, count]) => {
                const active = activeView === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectView(key)}
                    className={cn(
                      "text-muted-foreground hover:text-foreground relative flex h-9 items-center gap-1.5 text-xs font-medium transition-colors",
                      active && "text-foreground",
                    )}
                  >
                    {label}
                    <span className="text-[9px] tabular-nums opacity-55">
                      {count}
                    </span>
                    {active ? (
                      <span className="bg-foreground absolute right-0 bottom-0 left-0 h-px" />
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>
        </header>
      ) : null}

      <div
        className={cn(
          "flex min-h-0 flex-1",
          !detailMode &&
            "border-t border-black/[0.055] dark:border-white/[0.055]",
        )}
      >
        <main className="min-w-0 flex-1 overflow-y-auto">
          {activeView === "installed" ? (
            selectedAgent ? (
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
                  onSave={agentPreferences.save}
                  onUpdateChannelAgents={workspaceChannels.updateChannelAgents}
                />
              </section>
            ) : (
              <section className="p-6">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold tracking-[-0.02em]">
                      Your team
                    </h2>
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      Select an agent to review its tools, connections, and
                      runtime.
                    </p>
                  </div>
                  <div className="text-muted-foreground flex items-center gap-2 text-[10px] tabular-nums">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    {activeAgentCount} of {agents.length} active
                  </div>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(238px,1fr))] gap-3">
                  {agents.map((agent) => (
                    <TeamAgentCard
                      key={agent.id}
                      agent={agent}
                      override={overrides.find(
                        (entry) => entry.agentId === agent.id,
                      )}
                      workspaceId={cloudOrganizationId}
                      selected={false}
                      onSelect={() => {
                        setSearchParams((current) => {
                          const params = new URLSearchParams(current);
                          params.set("agent", agent.id);
                          params.delete("libraryAgent");
                          return params;
                        });
                      }}
                    />
                  ))}
                </div>
                {!ready ? (
                  <p className="text-muted-foreground mt-4 text-xs">
                    Connecting to your workspace…
                  </p>
                ) : null}
              </section>
            )
          ) : activeView === "available" ? (
            selectedAvailableAgent ? (
              <section className="mx-auto w-full max-w-4xl p-6">
                <nav className="text-muted-foreground mb-4 flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={closeDetail}
                    className="hover:text-foreground rounded-md px-1 py-1 transition-colors"
                  >
                    Agent library
                  </button>
                  <ChevronRight size={11} />
                  <span className="text-foreground font-medium">
                    {selectedAvailableAgent.name}
                  </span>
                </nav>
                <AvailableAgentDetail
                  agent={selectedAvailableAgent}
                  onClose={closeDetail}
                />
              </section>
            ) : (
              <section className="p-6">
                <div className="mb-5">
                  <h2 className="text-base font-semibold tracking-[-0.02em]">
                    Agent library
                  </h2>
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    Add a specialist when your team needs a narrower operating
                    role.
                  </p>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(238px,1fr))] gap-3">
                  {availableAgents.map((agent) => {
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => {
                          setSearchParams((current) => {
                            const params = new URLSearchParams(current);
                            params.set("libraryAgent", agent.id);
                            params.delete("agent");
                            return params;
                          });
                        }}
                        className="bg-muted hover:bg-accent/70 group flex min-h-48 flex-col rounded-[18px] p-4 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-[background-color,box-shadow]"
                      >
                        <span className="flex w-full items-start gap-3 pb-3">
                          <AgentAvatar
                            name={agent.name}
                            enabled={false}
                            size="md"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {agent.name}
                            </span>
                            <span className="text-muted-foreground mt-0.5 block truncate text-[10px]">
                              {agent.role}
                            </span>
                          </span>
                          <ChevronRight
                            size={13}
                            className="text-muted-foreground/60 mt-1 transition-transform group-hover:translate-x-0.5"
                          />
                        </span>
                        <span className="flex min-h-24 w-full flex-1 flex-col pt-1">
                          <span className="text-muted-foreground line-clamp-3 text-[11px] leading-5">
                            {agent.description}
                          </span>
                          <span className="text-muted-foreground mt-auto pt-3 text-[10px]">
                            Available soon
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )
          ) : (
            <div className="h-full">
              <PlaybooksCatalogue />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
