/* eslint-disable max-lines */

import { useEffect, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { Link, useNavigate, useSearchParams } from "react-router";

import type {
  AgentCapabilityId,
  AgentDefinition,
  AgentPreference,
  DriverType,
} from "@chief/agent-runtime/types";
import { defaultAgents } from "@chief/agent-runtime/agent-roster";
import { availableCapabilities } from "@chief/agent-runtime/capabilities";
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
import { Switch } from "@chief/ui/components/switch";
import { cn } from "@chief/ui/lib/utils";

import type { AgentOverride as LocalAgentOverride } from "../lib/agent-overrides";
import type { PlaybookCategory } from "../lib/playbooks";
import type { Provider } from "../lib/providers";
import { AgentChannelsPanel } from "../components/agents/agent-channels-panel";
import { AgentDeploymentPanel } from "../components/agents/agent-deployment-panel";
import { IntegrationAvatarStack } from "../components/integrations/integration-avatar-stack";
import { PlaybookDocument } from "../components/playbooks/playbook-document";
import { useAgentConfig } from "../lib/agent-config";
import {
  getWorkspaceProvider,
  setAgentOverride,
  setWorkspaceProvider,
} from "../lib/agent-overrides";
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
  useProviderModels,
  useRuntime,
} from "../lib/runtime";

type AgentOverride = AgentPreference;

interface IntegrationOption {
  provider: string;
  displayName: string;
}

const capabilityDetails: Record<
  AgentCapabilityId,
  { label: string; description: string }
> = {
  "analytics-chart": {
    label: "Analytics charts",
    description: "Turn reliable data into visual analysis.",
  },
  "prospect-memory": {
    label: "Prospect memory",
    description: "Keep useful prospects and their source evidence.",
  },
  "trend-memory": {
    label: "Trend memory",
    description: "Save supported market and audience signals.",
  },
  "content-calendar": {
    label: "Content calendar",
    description: "Create and track content drafts and schedules.",
  },
  "campaign-memory": {
    label: "Campaign memory",
    description: "Maintain durable campaign plans and status.",
  },
  "schedule-manager": {
    label: "Schedule manager",
    description: "Turn goals into recurring specialist work.",
  },
};

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

function ProviderOption({ provider }: { provider: Provider }) {
  const { label, Icon } = PROVIDER_META[provider];
  return (
    <span className="flex items-center gap-2">
      <Icon size={14} />
      {label}
    </span>
  );
}

function InstalledAgentCard({
  agent,
  workspaceId,
  override,
  integrations,
  ready,
  onSave,
  onDeploy,
}: {
  agent: AgentDefinition;
  workspaceId: string | null;
  override: AgentOverride | undefined;
  integrations: IntegrationOption[];
  ready: boolean;
  onSave: (preference: AgentPreference) => void;
  onDeploy?: () => void;
}) {
  const enabled = override?.enabled ?? true;
  // Per-agent override wins; otherwise the workspace's chosen agent app.
  // Null means neither exists yet — the select asks instead of assuming.
  const driver = override?.driver ?? getWorkspaceProvider(workspaceId);
  const models = useProviderModels(driver);
  const model = override?.model ?? "";
  const capabilities = override?.capabilities ?? agent.capabilities ?? [];
  const assignedIntegrations =
    override?.integrations ?? integrations.map((item) => item.provider);
  const [editing, setEditing] = useState(false);

  const save = (patch: {
    enabled?: boolean;
    driver?: DriverType;
    model?: string;
    capabilities?: AgentCapabilityId[];
    integrations?: string[];
  }) => {
    // The runtime-owned libSQL database is durable; this localStorage mirror
    // keeps session opening synchronous. Keep both in sync.
    const mirror: LocalAgentOverride = {};
    if ("enabled" in patch) mirror.enabled = patch.enabled;
    if (patch.driver) mirror.driver = patch.driver;
    if (patch.model !== undefined) mirror.model = patch.model || undefined;
    if (patch.capabilities) mirror.capabilities = patch.capabilities;
    if (patch.integrations) mirror.integrations = patch.integrations;
    if (workspaceId && Object.keys(mirror).length > 0) {
      setAgentOverride(workspaceId, agent.id, mirror);
    }
    // The first explicit driver choice becomes the workspace default so new
    // chats for every agent open resolved instead of asking.
    if (workspaceId && patch.driver && !getWorkspaceProvider(workspaceId)) {
      setWorkspaceProvider(workspaceId, patch.driver);
    }

    onSave({
      agentId: agent.id,
      enabled: patch.enabled ?? enabled,
      driver: patch.driver ?? driver ?? undefined,
      model: (patch.model ?? model) || undefined,
      capabilities: patch.capabilities ?? capabilities,
      integrations: patch.integrations ?? assignedIntegrations,
    });
  };

  const meta = driver ? PROVIDER_META[driver] : null;

  return (
    <div
      className={cn(
        "bg-card flex min-h-full flex-col p-6",
        !enabled && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {agent.name}
            {agent.delegates && (
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                Orchestrator
              </span>
            )}
          </p>
          <p className="text-muted-foreground truncate text-xs">{agent.role}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={!ready}
          onCheckedChange={(checked) => save({ enabled: checked })}
        />
      </div>

      <p className="text-muted-foreground mt-3 text-sm leading-6">
        {agent.description}
      </p>

      <div className="mt-6 border-t pt-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium">Configuration</p>
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            {editing ? "Done" : "Edit"}
          </button>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <section>
            <p className="text-muted-foreground mb-2 text-[11px]">
              Capabilities
            </p>
            <div className="divide-y border">
              {(editing
                ? availableCapabilities
                : availableCapabilities.filter((capability) =>
                    capabilities.includes(capability.id),
                  )
              ).map((capability) => {
                const checked = capabilities.includes(capability.id);
                const detail = capabilityDetails[capability.id];
                return (
                  <label
                    key={capability.id}
                    className="flex min-h-14 items-center justify-between gap-4 px-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">
                        {detail.label}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-[11px] leading-4">
                        {detail.description}
                      </span>
                    </span>
                    {editing ? (
                      <Switch
                        checked={checked}
                        disabled={!ready}
                        onCheckedChange={(next) =>
                          save({
                            capabilities: next
                              ? [...capabilities, capability.id]
                              : capabilities.filter(
                                  (id) => id !== capability.id,
                                ),
                          })
                        }
                      />
                    ) : (
                      <span className="bg-foreground size-1.5 shrink-0" />
                    )}
                  </label>
                );
              })}
              {!editing && capabilities.length === 0 ? (
                <p className="text-muted-foreground px-3 py-4 text-xs">
                  No optional capabilities
                </p>
              ) : null}
            </div>
          </section>

          <section>
            <p className="text-muted-foreground mb-2 text-[11px]">
              Connections
            </p>
            <div className="divide-y border">
              {(editing
                ? integrations
                : integrations.filter((integration) =>
                    assignedIntegrations.includes(integration.provider),
                  )
              ).map((integration) => {
                const checked = assignedIntegrations.includes(
                  integration.provider,
                );
                return (
                  <label
                    key={integration.provider}
                    className="flex min-h-14 items-center justify-between gap-4 px-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">
                        {integration.displayName}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-[11px]">
                        Connected service access
                      </span>
                    </span>
                    {editing ? (
                      <Switch
                        checked={checked}
                        disabled={!ready}
                        onCheckedChange={(next) =>
                          save({
                            integrations: next
                              ? [...assignedIntegrations, integration.provider]
                              : assignedIntegrations.filter(
                                  (provider) =>
                                    provider !== integration.provider,
                                ),
                          })
                        }
                      />
                    ) : (
                      <span className="bg-foreground size-1.5 shrink-0" />
                    )}
                  </label>
                );
              })}
              {(!editing && assignedIntegrations.length === 0) ||
              integrations.length === 0 ? (
                <p className="text-muted-foreground px-3 py-4 text-xs">
                  No connected services
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
        <div className="flex items-center gap-2">
          <Select
            value={driver ?? undefined}
            disabled={!ready}
            onValueChange={(value) =>
              save({ driver: value as DriverType, model: "" })
            }
          >
            <SelectTrigger className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground h-7 w-auto gap-1.5 border-transparent px-1 text-xs">
              {meta ? (
                <span className="flex items-center gap-1.5">
                  <meta.Icon size={13} />
                  {meta.label}
                </span>
              ) : (
                <span>Choose agent app</span>
              )}
            </SelectTrigger>
            <SelectContent className="min-w-36">
              <SelectGroup>
                <SelectLabel>Local</SelectLabel>
                <SelectItem value="claude">
                  <ProviderOption provider="claude" />
                </SelectItem>
                <SelectItem value="codex">
                  <ProviderOption provider="codex" />
                </SelectItem>
                <SelectItem value="opencode">
                  <ProviderOption provider="opencode" />
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {driver ? (
            <Select
              value={model || "__auto__"}
              disabled={!ready}
              onValueChange={(value) =>
                save({ model: value === "__auto__" ? "" : value })
              }
            >
              <SelectTrigger className="text-muted-foreground hover:text-foreground h-7 w-auto max-w-40 gap-1.5 border-transparent px-1 text-xs">
                <span className="truncate">
                  {models.loading
                    ? "Loading…"
                    : (models.models.find((item) => item.value === model)
                        ?.label ??
                        model) ||
                      "Auto"}
                </span>
              </SelectTrigger>
              <SelectContent className="max-h-72 min-w-52">
                {(models.models.length
                  ? models.models
                  : [{ value: "", label: "Auto" }]
                ).map((item) => (
                  <SelectItem
                    key={item.value || "auto"}
                    value={item.value || "__auto__"}
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {meta ? (
            <span className="text-muted-foreground text-xs">
              {meta.location}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/conversations"
            className="text-muted-foreground hover:bg-accent hover:text-foreground border px-2.5 py-1 text-xs transition-colors"
          >
            Ask Chief
          </Link>
          {onDeploy ? (
            <Button size="sm" onClick={onDeploy}>
              Deploy Chief
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AvailableAgentDetail({
  agent,
}: {
  agent: (typeof availableAgents)[number];
}) {
  return (
    <div className="flex h-full min-h-[620px] flex-col p-7">
      <div className="flex flex-wrap items-start justify-between gap-5 border-b pb-6">
        <div>
          <p className="text-muted-foreground text-xs">Available agent</p>
          <h3 className="mt-2 font-serif text-3xl">{agent.name}</h3>
          <p className="text-muted-foreground mt-2 text-sm">{agent.role}</p>
        </div>
        <Button size="sm" disabled>
          Coming soon
        </Button>
      </div>
      <div className="max-w-2xl py-7">
        <p className="text-muted-foreground text-sm leading-7">
          {agent.description}
        </p>
        <div className="mt-7 border p-4">
          <p className="text-sm font-medium">Not installed</p>
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            This specialist will appear in your team when the agent registry is
            ready. Its playbooks and connected-service access will be visible
            here before installation.
          </p>
        </div>
      </div>
    </div>
  );
}

// Last resolved integrations, so revisiting the page renders the access
// section in the first frame instead of popping it in after the query.
let integrationsCache: IntegrationOption[] | undefined;

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

  const schedule = () => {
    const chat = createChat(`Schedule ${selected.title}`);
    navigate(
      `/conversations?chat=${chat.id}&compose=recurring&playbook=${selected.id}`,
    );
  };

  const checkSetup = () => {
    const chat = createChat(`Prepare ${selected.title}`);
    navigate(
      `/conversations?chat=${chat.id}&prompt=${encodeURIComponent(`Prepare this playbook. Consult the setup specialist.\n\n${playbookSetupPrompt(selected)}`)}`,
    );
  };

  return (
    <div className="bg-card grid h-[calc(100vh-190px)] min-h-[620px] grid-cols-[320px_minmax(0,1fr)] border">
      <div className="flex min-h-0 flex-col border-r">
        <div className="border-b p-3">
          <Select
            value={category}
            onValueChange={(value) =>
              selectCategory(value as PlaybookCategory | "All")
            }
          >
            <SelectTrigger className="h-9 w-full text-xs">
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
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.map((playbook) => (
            <button
              key={playbook.id}
              type="button"
              onClick={() => setSelectedId(playbook.id)}
              className={cn(
                "hover:bg-accent flex w-full items-center gap-3 px-3 py-3 text-left transition-colors",
                selected.id === playbook.id && "bg-accent",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {playbook.title}
                </span>
                <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                  {playbook.summary}
                </span>
              </span>
              <IntegrationAvatarStack integrations={playbook.integrations} />
            </button>
          ))}
        </div>
      </div>

      <article className="min-h-0 min-w-0 overflow-y-auto">
        <div className="border-b p-7">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">
                Playbook · {owner?.name ?? selected.agentId}
              </p>
              <h3 className="mt-2 font-serif text-3xl">{selected.title}</h3>
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                {selected.summary}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={schedule}>
                Schedule
              </Button>
              <Button size="sm" onClick={runNow}>
                Run now
              </Button>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
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
        </div>
        <PlaybookDocument playbook={selected} />
      </article>
    </div>
  );
}

export function AgentsPage() {
  const [searchParams] = useSearchParams();
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
  const integrations: IntegrationOption[] = integrationsCache ?? [];
  // The runtime roster when connected; the static roster as a fallback so
  // the registry still renders while the runtime is down.
  const agents = runtimeAgents.length > 0 ? runtimeAgents : defaultAgents;

  const agentPreferences = useAgentPreferences(cloudOrganizationId);
  const overrides = agentPreferences.preferences;
  const ready = Boolean(cloudOrganizationId) && !agentPreferences.loading;
  const [view, setView] = useState<"installed" | "available" | "playbooks">(
    "installed",
  );
  const [selectedAgentId, setSelectedAgentId] = useState(
    () => agents[0]?.id ?? "",
  );
  const [selectedAvailableId, setSelectedAvailableId] = useState(
    () => availableAgents[0]?.id ?? "",
  );
  const [deploymentOpen, setDeploymentOpen] = useState(
    () => searchParams.get("view") === "deploy",
  );
  const [channelsOpen, setChannelsOpen] = useState(
    () => searchParams.get("view") === "channels",
  );
  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  useEffect(() => {
    if (agents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(agents[0]?.id ?? "");
  }, [agents, selectedAgentId]);

  // The localStorage mirror is hydrated app-wide by AgentConfigProvider.
  const agentConfig = useAgentConfig();

  return (
    <div className="-mx-8 -mb-8 flex min-h-[calc(100vh-48px)]">
      <aside className="w-56 shrink-0 border-r px-5 pt-10">
        <h1 className="font-serif text-3xl">Agents</h1>
        <nav className="mt-7 space-y-1">
          {[
            {
              key: "installed" as const,
              label: "Installed",
              count: agents.length,
            },
            {
              key: "available" as const,
              label: "Available",
              count: availableAgents.length,
            },
          ].map((item) => (
            <div key={item.key}>
              <button
                type="button"
                onClick={() => {
                  setView(item.key);
                  setDeploymentOpen(false);
                  setChannelsOpen(false);
                }}
                className={cn(
                  "text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors",
                  view === item.key &&
                    !deploymentOpen &&
                    !channelsOpen &&
                    "bg-accent text-foreground",
                )}
              >
                <span>{item.label}</span>
                <span className="text-muted-foreground text-[11px]">
                  {item.count}
                </span>
              </button>
              {view === item.key && !deploymentOpen && !channelsOpen ? (
                <div className="mt-1 ml-3 space-y-0.5 border-l pl-3">
                  {(item.key === "installed" ? agents : availableAgents).map(
                    (agent) => {
                      const installed = item.key === "installed";
                      const selected = installed
                        ? agent.id === selectedAgent?.id
                        : agent.id === selectedAvailableId;
                      const enabled = installed
                        ? (overrides.find((entry) => entry.agentId === agent.id)
                            ?.enabled ?? true)
                        : false;
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={() =>
                            installed
                              ? setSelectedAgentId(agent.id)
                              : setSelectedAvailableId(agent.id)
                          }
                          className={cn(
                            "text-muted-foreground hover:text-foreground flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors",
                            selected && "text-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0",
                              installed && enabled
                                ? "bg-emerald-500"
                                : "border-muted-foreground/50 border",
                            )}
                          />
                          <span className="truncate">{agent.name}</span>
                        </button>
                      );
                    },
                  )}
                </div>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setView("playbooks");
              setDeploymentOpen(false);
              setChannelsOpen(false);
            }}
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors",
              view === "playbooks" &&
                !deploymentOpen &&
                !channelsOpen &&
                "bg-accent text-foreground",
            )}
          >
            <span>Playbooks</span>
            <span className="text-muted-foreground text-[11px]">
              {PLAYBOOKS.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setChannelsOpen(false);
              setDeploymentOpen(true);
            }}
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center px-3 py-2 text-left text-sm transition-colors",
              deploymentOpen && "bg-accent text-foreground",
            )}
          >
            Deploy Chief
          </button>
          <button
            type="button"
            onClick={() => {
              setDeploymentOpen(false);
              setChannelsOpen(true);
            }}
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center px-3 py-2 text-left text-sm transition-colors",
              channelsOpen && "bg-accent text-foreground",
            )}
          >
            Connect channel
          </button>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-6 pt-10 pb-8">
        {channelsOpen ? (
          <AgentChannelsPanel
            workspaceId={cloudOrganizationId}
            onDeploy={() => {
              setChannelsOpen(false);
              setDeploymentOpen(true);
            }}
            onBack={() => {
              setChannelsOpen(false);
              setView("installed");
            }}
          />
        ) : deploymentOpen ? (
          <AgentDeploymentPanel
            onBack={() => {
              setDeploymentOpen(false);
              setView("installed");
            }}
          />
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
              <div>
                <h2 className="font-serif text-2xl">
                  {view === "installed"
                    ? "Your team"
                    : view === "available"
                      ? "Available agents"
                      : "Playbooks"}
                </h2>
                <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-6">
                  {view === "installed"
                    ? "Enable agents, choose the provider each one runs on, and open a conversation."
                    : view === "available"
                      ? "Specialists that can be added to the workspace as the registry expands."
                      : "Reusable operating instructions your agents can run now or own on a schedule."}
                </p>
              </div>
              {view === "installed" ? (
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDeploymentOpen(false);
                      setChannelsOpen(true);
                    }}
                  >
                    Connect channel
                  </Button>
                  <span
                    className="text-muted-foreground text-xs"
                    title="Automatic lets agents run their tools without asking; Ask first pauses every mutating tool call for your approval."
                  >
                    Tool approvals
                  </span>
                  <div className="flex border p-0.5">
                    {(
                      [
                        { mode: "auto", label: "Automatic" },
                        { mode: "ask", label: "Ask first" },
                      ] as const
                    ).map(({ mode, label }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => agentConfig.setApprovals(mode)}
                        className={cn(
                          "text-muted-foreground hover:text-foreground px-3 py-1.5 text-xs transition-colors",
                          agentConfig.approvals === mode &&
                            "bg-accent text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {view === "installed" ? (
              <>
                <div className="bg-card min-h-[620px] border">
                  {selectedAgent ? (
                    <InstalledAgentCard
                      key={selectedAgent.id}
                      agent={selectedAgent}
                      workspaceId={cloudOrganizationId}
                      override={overrides.find(
                        (item) => item.agentId === selectedAgent.id,
                      )}
                      integrations={integrations}
                      ready={ready}
                      onSave={agentPreferences.save}
                      onDeploy={
                        selectedAgent.id === "cmo"
                          ? () => setDeploymentOpen(true)
                          : undefined
                      }
                    />
                  ) : null}
                </div>
                {!ready ? (
                  <p className="text-muted-foreground mt-3 text-xs">
                    Connecting to your workspace…
                  </p>
                ) : null}
              </>
            ) : view === "available" ? (
              <div className="bg-card min-h-[620px] border">
                <AvailableAgentDetail
                  agent={
                    availableAgents.find(
                      (agent) => agent.id === selectedAvailableId,
                    ) ?? availableAgents[0]!
                  }
                />
              </div>
            ) : (
              <PlaybooksCatalogue />
            )}
          </>
        )}
      </main>
    </div>
  );
}
