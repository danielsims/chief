import { useEffect, useState } from "react";
import { Link } from "react-router";
import { defaultAgents } from "@marketer/agent-runtime/agents";
import { availableCapabilities } from "@marketer/agent-runtime/capabilities";
import type {
  AgentCapabilityId,
  AgentDefinition,
  AgentPreference,
  DriverType,
} from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@marketer/ui/components/select";
import { Switch } from "@marketer/ui/components/switch";
import { cn } from "@marketer/ui/lib/utils";
import { api } from "@marketer/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import {
  useAgentPreferences,
  useProviderModels,
  useRuntime,
} from "../lib/runtime";
import { useAuth } from "../lib/auth/auth-context";
import {
  type AgentOverride as LocalAgentOverride,
  getWorkspaceProvider,
  setAgentOverride,
} from "../lib/agent-overrides";
import { useAgentConfig } from "../lib/agent-config";
import { PROVIDER_META, type Provider } from "../lib/providers";

type AgentOverride = AgentPreference;

interface IntegrationOption {
  provider: string;
  displayName: string;
}

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
    name: "Email marketer",
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
}: {
  agent: AgentDefinition;
  workspaceId: string | null;
  override: AgentOverride | undefined;
  integrations: IntegrationOption[];
  ready: boolean;
  onSave: (preference: AgentPreference) => void;
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
        "flex min-h-full flex-col bg-card p-6",
        !enabled && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {agent.name}
            {agent.delegates && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Orchestrator
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">{agent.role}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={!ready}
          onCheckedChange={(checked) => save({ enabled: checked })}
        />
      </div>

      <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
        {agent.description}
      </p>

      <div className="mt-4 border-t pt-3">
        <p className="mb-2 text-[11px] text-muted-foreground">Capabilities</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {availableCapabilities.map((capability) => {
            const checked = capabilities.includes(capability.id);
            return (
              <label
                key={capability.id}
                className="flex items-center justify-between gap-3 border px-3 py-2 text-xs"
              >
                <span>{capability.id.replace(/-/g, " ")}</span>
                <Switch
                  checked={checked}
                  disabled={!ready}
                  onCheckedChange={(next) =>
                    save({
                      capabilities: next
                        ? [...capabilities, capability.id]
                        : capabilities.filter((id) => id !== capability.id),
                    })
                  }
                />
              </label>
            );
          })}
        </div>
      </div>

      {integrations.length > 0 ? (
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 text-[11px] text-muted-foreground">
            Integration access
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {integrations.map((integration) => {
              const checked = assignedIntegrations.includes(
                integration.provider,
              );
              return (
                <label
                  key={integration.provider}
                  className="flex items-center justify-between gap-3 border px-3 py-2 text-xs"
                >
                  <span className="truncate">{integration.displayName}</span>
                  <Switch
                    checked={checked}
                    disabled={!ready}
                    onCheckedChange={(next) =>
                      save({
                        integrations: next
                          ? [...assignedIntegrations, integration.provider]
                          : assignedIntegrations.filter(
                              (provider) => provider !== integration.provider,
                            ),
                      })
                    }
                  />
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
        <div className="flex items-center gap-2">
          <Select
            value={driver ?? undefined}
            disabled={!ready}
            onValueChange={(value) =>
              save({ driver: value as DriverType, model: "" })
            }
          >
            <SelectTrigger className="h-7 w-auto gap-1.5 border-transparent px-1 text-xs text-muted-foreground hover:text-foreground data-[state=open]:text-foreground">
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
              <SelectTrigger className="h-7 w-auto max-w-40 gap-1.5 border-transparent px-1 text-xs text-muted-foreground hover:text-foreground">
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
            <span className="text-xs text-muted-foreground">
              {meta.location}
            </span>
          ) : null}
        </div>
        <Link
          to={`/conversations?agent=${agent.id}`}
          className="border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Open chat
        </Link>
      </div>
    </div>
  );
}

function AvailableAgentCard({
  agent,
}: {
  agent: (typeof availableAgents)[number];
}) {
  return (
    <div className="flex flex-col border border-dashed p-5">
      <div>
        <p className="text-sm font-medium">{agent.name}</p>
        <p className="text-xs text-muted-foreground">{agent.role}</p>
      </div>
      <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
        {agent.description}
      </p>
      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
        <span className="text-xs text-muted-foreground">Coming soon</span>
        <Button size="sm" variant="outline" disabled className="h-7 text-xs">
          Install
        </Button>
      </div>
    </div>
  );
}

// Last resolved integrations, so revisiting the page renders the access
// section in the first frame instead of popping it in after the query.
let integrationsCache: IntegrationOption[] | undefined;

export function AgentsPage() {
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
  const [view, setView] = useState<"installed" | "available">("installed");
  const [selectedAgentId, setSelectedAgentId] = useState(
    () => agents[0]?.id ?? "",
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
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={cn(
                "flex w-full items-center justify-between px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                view === item.key && "bg-accent text-foreground",
              )}
            >
              <span>{item.label}</span>
              <span className="text-[11px] text-muted-foreground">
                {item.count}
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-6 pb-8 pt-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="font-serif text-2xl">
              {view === "installed" ? "Your team" : "Available agents"}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {view === "installed"
                ? "Enable agents, choose the provider each one runs on, and open a conversation."
                : "Specialists that can be added to the workspace as the registry expands."}
            </p>
          </div>
          {view === "installed" ? (
            <div className="flex items-center gap-3">
              <span
                className="text-xs text-muted-foreground"
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
                      "px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
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
            <div className="grid min-h-[620px] grid-cols-[260px_minmax(0,1fr)] border bg-card">
              <div className="border-r p-2">
                {agents.map((agent) => {
                  const override = overrides.find(
                    (item) => item.agentId === agent.id,
                  );
                  const enabled = override?.enabled ?? true;
                  const selected = agent.id === selectedAgent?.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent",
                        selected && "bg-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0",
                          enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {agent.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {agent.role}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="min-w-0">
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
                  />
                ) : null}
              </div>
            </div>
            {!ready ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Connecting to your workspace…
              </p>
            ) : null}
          </>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {availableAgents.map((agent) => (
              <AvailableAgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
