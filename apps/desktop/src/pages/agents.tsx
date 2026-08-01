/* eslint-disable max-lines */

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  ChevronRight,
  Cloud,
  MessageCircle,
  Radio,
  Settings2,
  X,
} from "lucide-react";
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
import { PageTitle } from "../components/page-title";
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

function agentInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

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
        "bg-foreground text-background relative flex shrink-0 items-center justify-center rounded-xl font-semibold shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--background)_12%,transparent),inset_0_1px_color-mix(in_srgb,var(--background)_10%,transparent)]",
        size === "sm" && "size-8 text-[10px]",
        size === "md" && "size-10 text-xs",
        size === "lg" && "size-12 text-sm",
        size === "xl" && "size-[72px] rounded-full text-lg",
      )}
    >
      {agentInitials(name)}
      <span
        className={cn(
          "border-background absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2",
          enabled ? "bg-emerald-500" : "bg-muted-foreground/35",
        )}
      />
    </span>
  );
}

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
  onClose,
  onDeploy,
}: {
  agent: AgentDefinition;
  workspaceId: string | null;
  override: AgentOverride | undefined;
  integrations: IntegrationOption[];
  ready: boolean;
  onSave: (preference: AgentPreference) => void;
  onClose?: () => void;
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
        "bg-card/45 flex min-h-full flex-col rounded-2xl p-6 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),0_1px_2px_rgba(0,0,0,0.025)]",
        !enabled && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <AgentAvatar name={agent.name} enabled={enabled} size="lg" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-[-0.025em]">
                {agent.name}
              </h2>
              {agent.delegates ? (
                <span className="bg-foreground/[0.045] text-muted-foreground rounded-full px-2 py-1 text-[9px] font-medium">
                  Orchestrator
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {agent.role}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground flex items-center gap-2 text-[10px]">
            {enabled ? "Active" : "Paused"}
            <Switch
              checked={enabled}
              disabled={!ready}
              onCheckedChange={(checked) => save({ enabled: checked })}
            />
          </label>
          {onClose ? (
            <button
              type="button"
              aria-label="Close agent details"
              onClick={onClose}
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-lg transition-colors"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      </div>

      <p className="text-muted-foreground mt-5 max-w-3xl text-sm leading-6">
        {agent.description}
      </p>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <div className="bg-background/55 rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
          <p className="text-muted-foreground text-[9px]">Capabilities</p>
          <p className="mt-1 text-xs font-semibold">{capabilities.length}</p>
        </div>
        <div className="bg-background/55 rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
          <p className="text-muted-foreground text-[9px]">Connections</p>
          <p className="mt-1 text-xs font-semibold">
            {assignedIntegrations.length}
          </p>
        </div>
        <div className="bg-background/55 rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
          <p className="text-muted-foreground text-[9px]">Runs with</p>
          <p className="mt-1 truncate text-xs font-semibold">
            {meta?.label ?? "Not configured"}
          </p>
        </div>
      </div>

      <div className="mt-6 pt-4 shadow-[inset_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold">Configuration</p>
            <p className="text-muted-foreground mt-0.5 text-[10px]">
              What this agent can use and remember.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors"
          >
            {editing ? "Done" : "Edit"}
          </button>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <section>
            <p className="text-muted-foreground mb-2 text-[11px]">
              Capabilities
            </p>
            <div className="bg-background/55 divide-y divide-black/[0.055] overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)] dark:divide-white/[0.055]">
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
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
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
            <div className="bg-background/55 divide-y divide-black/[0.055] overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)] dark:divide-white/[0.055]">
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
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
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

      <div className="mt-auto flex items-center justify-between gap-3 pt-4 shadow-[inset_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
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
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)] transition-colors"
          >
            <MessageCircle size={12} />
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
    <div className="bg-card/45 grid h-full min-h-[620px] grid-cols-[300px_minmax(0,1fr)] overflow-hidden rounded-2xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
      <div className="flex min-h-0 flex-col shadow-[inset_-1px_0_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
        <div className="p-3 shadow-[inset_0_-1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
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
                "hover:bg-accent flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors",
                selected.id === playbook.id && "bg-accent/80",
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
        <div className="p-7 shadow-[inset_0_-1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">
                Playbook · {owner?.name ?? selected.agentId}
              </p>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {selected.title}
              </h3>
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
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 pt-4 shadow-[inset_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
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
  const integrations: IntegrationOption[] = integrationsCache ?? [];
  const agents = runtimeAgents.length > 0 ? runtimeAgents : defaultAgents;
  const agentPreferences = useAgentPreferences(cloudOrganizationId);
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
  const [channelsOpen, setChannelsOpen] = useState(
    () => searchParams.get("view") === "channels",
  );
  const activeAgentCount = agents.filter(
    (agent) =>
      overrides.find((entry) => entry.agentId === agent.id)?.enabled ?? true,
  ).length;

  const agentConfig = useAgentConfig();
  const selectView = (next: "installed" | "available" | "playbooks") => {
    setView(next);
    setDeploymentOpen(false);
    setChannelsOpen(false);
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
      <header className="shrink-0 px-6 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <PageTitle>Agents</PageTitle>
            <p className="text-muted-foreground mt-1 text-[13px]">
              See who is available, what they can access, and where they are
              working.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                closeDetail();
                setDeploymentOpen(false);
                setChannelsOpen(true);
              }}
            >
              <Radio size={13} />
              Channels
            </Button>
            <Button
              size="sm"
              onClick={() => {
                closeDetail();
                setChannelsOpen(false);
                setDeploymentOpen(true);
              }}
            >
              <Cloud size={13} />
              Deploy Chief
            </Button>
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
              const active =
                activeView === key && !deploymentOpen && !channelsOpen;
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

          {activeView === "installed" && !deploymentOpen && !channelsOpen ? (
            <div className="bg-muted/40 mb-1 flex items-center gap-1 rounded-lg p-0.5 pl-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
              <span className="text-muted-foreground mr-1 flex items-center gap-1.5 text-[10px]">
                <Settings2 size={11} />
                Approvals
              </span>
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
                    "text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-[background-color,box-shadow,color]",
                    agentConfig.approvals === mode &&
                      "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06),inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 border-t border-black/[0.055] dark:border-white/[0.055]">
        <main className="min-w-0 flex-1 overflow-y-auto">
          {channelsOpen ? (
            <div className="p-6">
              <AgentChannelsPanel
                workspaceId={cloudOrganizationId}
                onDeploy={() => {
                  setChannelsOpen(false);
                  setDeploymentOpen(true);
                }}
                onBack={() => selectView("installed")}
              />
            </div>
          ) : deploymentOpen ? (
            <div className="p-6">
              <AgentDeploymentPanel onBack={() => selectView("installed")} />
            </div>
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
                      ? () => {
                          closeDetail();
                          setDeploymentOpen(true);
                        }
                      : undefined
                  }
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
                <div className="bg-foreground/[0.035] min-h-[520px] rounded-[24px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
                  <AvailableAgentDetail
                    agent={selectedAvailableAgent}
                    onClose={closeDetail}
                  />
                </div>
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
            <div className="h-full p-6">
              <PlaybooksCatalogue />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
