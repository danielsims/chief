/* eslint-disable max-lines */

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { ChevronRight, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import type {
  AgentDefinition,
  AgentPreference,
} from "@chief/agent-runtime/types";
import { defaultAgents } from "@chief/agent-runtime/agent-roster";
import { api } from "@chief/backend/convex/_generated/api";
import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

import type { AgentIntegrationOption } from "../components/agents/agent-detail";
import type { PlaybookCategory } from "../lib/playbooks";
import { AgentAvatar as ChiefAgentAvatar } from "../components/agent-avatar";
import { AgentDeploymentPanel } from "../components/agents/agent-deployment-panel";
import { AgentDetail } from "../components/agents/agent-detail";
import { IntegrationAvatarStack } from "../components/integrations/integration-avatar-stack";
import { PageTitle } from "../components/page-title";
import { PlaybookDocument } from "../components/playbooks/playbook-document";
import { getWorkspaceProvider } from "../lib/agent-overrides";
import { useAuth } from "../lib/auth/auth-context";
import { createChat } from "../lib/chat-log";
import {
  PLAYBOOK_CATEGORIES,
  playbookRunPrompt,
  PLAYBOOKS,
  playbookSetupPrompt,
} from "../lib/playbooks";
import { PROVIDER_META } from "../lib/providers";
import {
  useAgentPreferences,
  useRuntime,
  useWorkspaceChannels,
} from "../lib/runtime";

type AgentOverride = AgentPreference;

/**
 * Agents a registry backend will offer later. Shown here so the page reads
 * as a registry from day one; install mechanics come with the registry PRD.
 */
const availableAgents = [
  {
    id: "seo",
    name: "SEO specialist",
    role: "Search & site content",
    description:
      "Audits your site, finds keyword gaps and drafts pages that can rank.",
  },
  {
    id: "email",
    name: "Email specialist",
    role: "Lifecycle & newsletters",
    description:
      "Writes campaigns and drip sequences and keeps your list healthy.",
  },
  {
    id: "community",
    name: "Community manager",
    role: "Community & replies",
    description:
      "Watches your channels for mentions and drafts replies in your voice.",
  },
  {
    id: "brand",
    name: "Brand designer",
    role: "Visual identity",
    description:
      "Keeps logos, colors and social templates consistent across channels.",
  },
];

function AgentAvatar({
  name,
  enabled = true,
  size = "md",
}: {
  name: string;
  enabled?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  return (
    <span
      className={cn(
        "relative flex shrink-0",
        size === "sm" && "size-8",
        size === "md" && "size-10",
        size === "lg" && "size-12",
        size === "xl" && "size-[72px]",
      )}
    >
      <ChiefAgentAvatar label={name} className="size-full" />
      <span
        className={cn(
          "border-background absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2",
          enabled ? "bg-emerald-500" : "bg-muted-foreground/35",
        )}
      />
    </span>
  );
}

function TeamAgentCard({
  agent,
  override,
  workspaceId,
  selected,
  onSelect,
}: {
  agent: AgentDefinition;
  override: AgentOverride | undefined;
  workspaceId: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const enabled = override?.enabled ?? true;
  const driver = override?.driver ?? getWorkspaceProvider(workspaceId);
  const meta = driver ? PROVIDER_META[driver] : null;
  const capabilityCount =
    override?.capabilities?.length ?? agent.capabilities?.length ?? 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "bg-muted hover:bg-accent/70 group flex min-h-48 flex-col rounded-[18px] px-4 py-4 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),0_1px_2px_rgba(0,0,0,0.025)] transition-[background-color,box-shadow]",
        selected &&
          "bg-accent/40 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent),0_2px_8px_rgba(0,0,0,0.035)]",
      )}
    >
      <span className="flex w-full flex-1 flex-col">
        <span className="flex min-h-24 items-center justify-center py-1">
          <AgentAvatar name={agent.name} enabled={enabled} size="xl" />
        </span>
        <span className="mt-3 flex items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="block truncate text-sm font-semibold">
                {agent.name}
              </span>
              {agent.delegates ? (
                <span className="text-muted-foreground bg-foreground/[0.045] rounded-full px-1.5 py-0.5 text-[8px] font-medium">
                  Lead
                </span>
              ) : null}
            </span>
            <span className="text-muted-foreground mt-0.5 block truncate text-[10px]">
              {agent.role}
            </span>
          </span>
          <ChevronRight
            size={13}
            className="text-muted-foreground/60 mt-1 shrink-0 transition-transform group-hover:translate-x-0.5"
          />
        </span>
        <span className="mt-auto flex w-full items-center gap-2 pt-3 text-[10px]">
          <span
            className={cn(
              "size-1.5 rounded-full",
              enabled ? "bg-emerald-500" : "bg-muted-foreground/35",
            )}
          />
          <span className="text-muted-foreground">
            {enabled ? "Active" : "Paused"}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground truncate">
            {meta?.label ?? "Choose agent app"}
          </span>
          <span className="text-muted-foreground/40 ml-auto">
            {capabilityCount} capabilities
          </span>
        </span>
      </span>
    </button>
  );
}

function AvailableAgentDetail({
  agent,
  onClose,
}: {
  agent: (typeof availableAgents)[number];
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col p-5">
      <div className="flex items-start justify-between gap-4 pb-5 shadow-[inset_0_-1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
        <div className="flex items-center gap-3.5">
          <AgentAvatar name={agent.name} enabled={false} size="lg" />
          <div>
            <h3 className="text-lg font-semibold tracking-[-0.025em]">
              {agent.name}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">{agent.role}</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close agent details"
          onClick={onClose}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-lg transition-colors"
        >
          <X size={13} />
        </button>
      </div>
      <div className="py-5">
        <p className="text-muted-foreground text-sm leading-6">
          {agent.description}
        </p>
        <div className="bg-foreground/[0.025] mt-5 rounded-xl p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
          <p className="text-xs font-semibold">Available soon</p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            Review its access and playbooks here before adding it to your team.
          </p>
        </div>
      </div>
      <Button className="mt-auto" disabled>
        Add to team
      </Button>
    </div>
  );
}

// Last resolved integrations, so revisiting the page renders the access
// section in the first frame instead of popping it in after the query.
let integrationsCache: AgentIntegrationOption[] | undefined;

function PlaybooksCatalogue() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<PlaybookCategory | "All">("All");
  const visible =
    category === "All"
      ? PLAYBOOKS
      : PLAYBOOKS.filter((playbook) => playbook.categories.includes(category));
  const [selectedId, setSelectedId] = useState(
    () => visible[0]?.id ?? PLAYBOOKS[0]!.id,
  );
  const selected =
    visible.find((playbook) => playbook.id === selectedId) ??
    visible[0] ??
    PLAYBOOKS[0]!;
  const owner = defaultAgents.find((agent) => agent.id === selected.agentId);

  const selectCategory = (next: PlaybookCategory | "All") => {
    setCategory(next);
    const first =
      next === "All"
        ? PLAYBOOKS[0]
        : PLAYBOOKS.find((playbook) => playbook.categories.includes(next));
    if (first) setSelectedId(first.id);
  };

  const runNow = () => {
    const chat = createChat(selected.title);
    navigate(
      `/conversations?chat=${chat.id}&prompt=${encodeURIComponent(`Run this playbook. Consult the ${owner?.name ?? selected.agentId} specialist.\n\n${playbookRunPrompt(selected)}`)}`,
    );
  };

  const checkSetup = () => {
    const chat = createChat(`Prepare ${selected.title}`);
    navigate(
      `/conversations?chat=${chat.id}&prompt=${encodeURIComponent(`Prepare this playbook. Consult the setup specialist.\n\n${playbookSetupPrompt(selected)}`)}`,
    );
  };

  return (
    <div className="grid h-full min-h-[620px] grid-cols-[316px_minmax(0,1fr)] overflow-hidden">
      <aside className="bg-muted/20 flex min-h-0 flex-col border-r border-black/[0.055] dark:border-white/[0.06]">
        <div className="border-b border-black/[0.055] p-4 dark:border-white/[0.06]">
          <Select
            value={category}
            onValueChange={(value) =>
              selectCategory(value as PlaybookCategory | "All")
            }
          >
            <SelectTrigger className="bg-background h-9 w-full rounded-lg text-xs shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
              {category === "All" ? "All playbooks" : category}
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Filter playbooks</SelectLabel>
                {(["All", ...PLAYBOOK_CATEGORIES] as const).map((item) => (
                  <SelectItem key={item} value={item}>
                    {item === "All" ? "All playbooks" : item}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {visible.map((playbook) => (
            <button
              key={playbook.id}
              type="button"
              onClick={() => setSelectedId(playbook.id)}
              className={cn(
                "hover:bg-accent/70 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-[background-color,box-shadow]",
                selected.id === playbook.id &&
                  "bg-background shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),0_1px_2px_rgba(0,0,0,0.025)]",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {playbook.title}
                </span>
                <span className="text-muted-foreground mt-1 block truncate text-[11px]">
                  {playbook.summary}
                </span>
              </span>
              <IntegrationAvatarStack integrations={playbook.integrations} />
            </button>
          ))}
        </div>
      </aside>

      <article className="min-h-0 min-w-0 overflow-y-auto">
        <header className="border-b border-black/[0.055] px-8 py-7 dark:border-white/[0.06]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-muted-foreground text-[11px]">
                Playbook · {owner?.name ?? selected.agentId}
              </p>
              <h2 className="mt-2 text-[24px] leading-tight font-normal tracking-[-0.035em]">
                {selected.title}
              </h2>
              <p className="text-muted-foreground mt-2 max-w-2xl text-[13px] leading-5">
                {selected.summary}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={runNow}>
                Run now
              </Button>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-black/[0.05] pt-4 dark:border-white/[0.055]">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <IntegrationAvatarStack
                integrations={selected.integrations}
                max={10}
              />
              <span className="text-muted-foreground text-xs">
                {selected.integrations.map((item) => item.label).join(", ")}
              </span>
            </div>
            <button
              type="button"
              onClick={checkSetup}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 transition-colors hover:underline"
            >
              Check setup
            </button>
          </div>
        </header>
        <PlaybookDocument playbook={selected} />
      </article>
    </div>
  );
}

export function AgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { agents: runtimeAgents } = useRuntime();
  const { cloudOrganizationId } = useAuth();
  const convexAuth = useConvexAuth();
  const connectedIntegrations = useQuery(
    api.integrations.listConnected,
    convexAuth.isAuthenticated && cloudOrganizationId ? {} : "skip",
  );
  if (connectedIntegrations !== undefined) {
    integrationsCache = connectedIntegrations.map((integration) => ({
      provider: integration.provider,
      displayName: integration.displayName,
    }));
  }
  const integrations: AgentIntegrationOption[] = integrationsCache ?? [];
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
  const [deploymentOpen, setDeploymentOpen] = useState(
    () => searchParams.get("view") === "deploy",
  );
  const activeAgentCount = agents.filter(
    (agent) =>
      overrides.find((entry) => entry.agentId === agent.id)?.enabled ?? true,
  ).length;
  const deploymentAgent =
    selectedAgent ??
    agents.find((agent) => agent.id === "chief") ??
    agents[0] ??
    null;
  const detailMode =
    selectedAgent !== undefined ||
    selectedAvailableAgent !== undefined ||
    deploymentOpen;

  const selectView = (next: "installed" | "available" | "playbooks") => {
    setView(next);
    setDeploymentOpen(false);
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
  const openAgentDeployment = (nextAgentId: string) => {
    setView("installed");
    setDeploymentOpen(true);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set("agent", nextAgentId);
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
          {deploymentOpen ? (
            deploymentAgent ? (
              <div className="p-6">
                <AgentDeploymentPanel
                  key={deploymentAgent.id}
                  agent={deploymentAgent}
                  onBack={() => setDeploymentOpen(false)}
                />
              </div>
            ) : null
          ) : activeView === "installed" ? (
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
                  onDeploy={() => openAgentDeployment(selectedAgent.id)}
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
