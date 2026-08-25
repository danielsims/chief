import { useState } from "react";
import { CircleAlert, MessageCircle, Users, X } from "lucide-react";
import { Link } from "react-router";

import type {
  AgentApprovalMode,
  AgentCapabilityId,
  AgentDefinition,
  AgentPreference,
  AgentToolPermission,
  DriverType,
  WorkspaceChannel,
} from "@chief/agent-runtime/types";
import { effectiveAgentToolPermissions } from "@chief/agent-runtime/agent-tool-permissions";
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

import type { AgentOverride as LocalAgentOverride } from "../../lib/agent-overrides";
import type { Provider } from "../../lib/providers";
import type { AgentIntegrationOption } from "./agent-detail-sections";
import {
  getToolApprovals,
  getWorkspaceProvider,
  setAgentOverride,
  setWorkspaceProvider,
} from "../../lib/agent-overrides";
import { PROVIDER_META } from "../../lib/providers";
import { useProviderModels } from "../../lib/runtime";
import { AgentAvatar as ChiefAgentAvatar } from "../agent-avatar";
import {
  AgentChannelsTab,
  AgentConfigurationTab,
  AgentPermissionsTab,
} from "./agent-detail-sections";

export type { AgentIntegrationOption } from "./agent-detail-sections";

type DetailTab = "configuration" | "channels" | "permissions";

const detailTabs: readonly { id: DetailTab; label: string }[] = [
  { id: "configuration", label: "Configuration" },
  { id: "channels", label: "Channels" },
  { id: "permissions", label: "Permissions" },
];

function DetailAgentAvatar({
  name,
  enabled,
}: {
  name: string;
  enabled: boolean;
}) {
  return (
    <span className="relative flex size-14 shrink-0">
      <ChiefAgentAvatar label={name} className="size-full" />
      <span
        className={cn(
          "border-background absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-[3px]",
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

export function AgentDetail({
  agent,
  workspaceId,
  override,
  integrations,
  channels,
  ready,
  saving,
  preferenceError,
  onSave,
  onApplyExecutionToTeam,
  onClose,
  onUpdateChannelAgents,
}: {
  agent: AgentDefinition;
  workspaceId: string | null;
  override: AgentPreference | undefined;
  integrations: AgentIntegrationOption[];
  channels: readonly WorkspaceChannel[];
  ready: boolean;
  saving: boolean;
  preferenceError: string | null;
  onSave: (preference: AgentPreference) => void;
  onApplyExecutionToTeam: (driver: DriverType, model?: string) => void;
  onClose?: () => void;
  onUpdateChannelAgents: (channelId: string, agentIds: string[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("configuration");
  const enabled = override?.enabled ?? true;
  const driver = override
    ? (override.driver ?? null)
    : getWorkspaceProvider(workspaceId);
  const model = override?.model ?? "";
  const [executionDraft, setExecutionDraft] = useState<{
    driver: DriverType;
    model: string;
  } | null>(null);
  const selectedDriver = executionDraft?.driver ?? driver;
  const selectedModel = executionDraft?.model ?? model;
  const models = useProviderModels(selectedDriver);
  const approvals = override?.approvals ?? getToolApprovals(workspaceId);
  const capabilities = override?.capabilities ?? agent.capabilities ?? [];
  const assignedIntegrations =
    override?.integrations ?? integrations.map((item) => item.provider);
  const toolPermissions = effectiveAgentToolPermissions(
    agent.id,
    override?.toolPermissions,
  );
  const meta = selectedDriver ? PROVIDER_META[selectedDriver] : null;
  const executionChanged = Boolean(
    selectedDriver && (selectedDriver !== driver || selectedModel !== model),
  );
  const sharedChannels = channels.filter(
    (channel) => channel.visibility !== "direct",
  );

  const save = (patch: {
    enabled?: boolean;
    driver?: DriverType;
    model?: string;
    approvals?: AgentApprovalMode;
    capabilities?: AgentCapabilityId[];
    integrations?: string[];
    toolPermissions?: AgentToolPermission[];
  }) => {
    const mirror: LocalAgentOverride = {};
    if ("enabled" in patch) mirror.enabled = patch.enabled;
    if (patch.driver) mirror.driver = patch.driver;
    if (patch.model !== undefined) mirror.model = patch.model || undefined;
    if (patch.approvals) mirror.approvals = patch.approvals;
    if (patch.capabilities) mirror.capabilities = patch.capabilities;
    if (patch.integrations) mirror.integrations = patch.integrations;
    if (patch.toolPermissions) mirror.toolPermissions = patch.toolPermissions;
    if (workspaceId && Object.keys(mirror).length > 0) {
      setAgentOverride(workspaceId, agent.id, mirror);
    }
    if (workspaceId && patch.driver && !getWorkspaceProvider(workspaceId)) {
      setWorkspaceProvider(workspaceId, patch.driver);
    }

    onSave({
      agentId: agent.id,
      enabled: patch.enabled ?? enabled,
      driver: patch.driver ?? driver ?? undefined,
      model: (patch.model ?? model) || undefined,
      approvals: patch.approvals ?? approvals,
      capabilities: patch.capabilities ?? capabilities,
      integrations: patch.integrations ?? assignedIntegrations,
      toolPermissions: patch.toolPermissions ?? toolPermissions,
    });
  };

  const applyExecution = () => {
    if (!selectedDriver) return;
    save({ driver: selectedDriver, model: selectedModel });
    setExecutionDraft(null);
  };

  const applyExecutionToTeam = () => {
    if (!selectedDriver) return;
    onApplyExecutionToTeam(selectedDriver, selectedModel || undefined);
    setExecutionDraft(null);
  };

  return (
    <div className={cn("min-h-full", !enabled && "opacity-65")}>
      <header>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <DetailAgentAvatar name={agent.name} enabled={enabled} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[26px] leading-none font-normal tracking-[-0.04em]">
                  {agent.name}
                </h2>
                {agent.delegates ? (
                  <span className="bg-muted/60 text-muted-foreground rounded-full px-2 py-1 text-[9px] font-medium">
                    Orchestrator
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs">
                {agent.role}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-muted-foreground mr-1 flex items-center gap-2 text-[11px]">
              {enabled ? "Active" : "Paused"}
              <Switch
                checked={enabled}
                disabled={!ready}
                onCheckedChange={(checked) => save({ enabled: checked })}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  to={`/conversations?dm=${encodeURIComponent(agent.id)}`}
                />
              }
            >
              <MessageCircle size={13} />
              Message
            </Button>
            {onClose ? (
              <button
                type="button"
                aria-label="Close agent details"
                onClick={onClose}
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>

        <p className="text-muted-foreground mt-5 max-w-3xl text-[13px] leading-6">
          {agent.description}
        </p>

        <div className="bg-muted/25 mt-6 rounded-2xl px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium">
                Agent provider and model
              </p>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                {meta
                  ? `${agent.name} runs through ${meta.label}.`
                  : "Choose the provider that runs this agent."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selectedDriver ?? undefined}
                disabled={!ready}
                onValueChange={(value) => {
                  if (isDriverType(value)) {
                    setExecutionDraft({ driver: value, model: "" });
                  }
                }}
              >
                <SelectTrigger className="bg-background/70 h-9 w-auto min-w-40 rounded-xl px-2.5 text-xs">
                  {meta ? (
                    <span className="flex items-center gap-2">
                      <meta.Icon size={14} />
                      {meta.label}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Choose provider
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent className="min-w-40">
                  <SelectGroup>
                    <SelectLabel>Agent providers</SelectLabel>
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
              {selectedDriver ? (
                <Select
                  value={selectedModel || "__auto__"}
                  disabled={!ready}
                  onValueChange={(value) =>
                    setExecutionDraft({
                      driver: selectedDriver,
                      model: value === "__auto__" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger className="bg-background/70 h-9 w-auto max-w-56 min-w-40 rounded-xl px-2.5 text-xs">
                    <span className="truncate">
                      {models.loading
                        ? "Loading…"
                        : (models.models.find(
                            (item) => item.value === selectedModel,
                          )?.label ??
                            selectedModel) ||
                          "Auto-select model"}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="max-h-72 min-w-56">
                    {(models.models.length
                      ? models.models
                      : [{ value: "", label: "Auto-select model" }]
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
            </div>
          </div>

          {!driver ? (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2.5">
              <CircleAlert
                size={14}
                className="mt-0.5 shrink-0 text-amber-500"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">Agent provider required</p>
                <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">
                  {agent.name} cannot respond until you assign a provider and
                  model.
                </p>
              </div>
            </div>
          ) : null}

          {preferenceError ? (
            <div className="border-destructive/20 bg-destructive/5 mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5">
              <CircleAlert
                size={14}
                className="text-destructive mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  Agent provider was not saved
                </p>
                <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">
                  {preferenceError}
                </p>
              </div>
            </div>
          ) : null}

          {executionChanged ? (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!ready || saving}
                onClick={applyExecutionToTeam}
              >
                <Users size={13} />
                Apply to team
              </Button>
              <Button
                size="sm"
                disabled={!ready || saving}
                onClick={applyExecution}
              >
                {saving ? "Saving…" : `Apply to ${agent.name}`}
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <nav
        className="mt-7 flex items-center gap-6 border-b border-black/[0.06] dark:border-white/[0.065]"
        aria-label="Agent details"
        role="tablist"
      >
        {detailTabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              id={`agent-detail-tab-${tab.id}`}
              role="tab"
              aria-controls="agent-detail-panel"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "text-muted-foreground hover:text-foreground relative h-10 text-xs font-medium transition-colors",
                active && "text-foreground",
              )}
            >
              {tab.label}
              {active ? (
                <span className="bg-foreground absolute right-0 bottom-[-1px] left-0 h-px" />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div
        id="agent-detail-panel"
        role="tabpanel"
        aria-labelledby={`agent-detail-tab-${activeTab}`}
        className="max-w-4xl py-7 pb-12"
      >
        {activeTab === "configuration" ? (
          <AgentConfigurationTab
            approvals={approvals}
            ready={ready}
            capabilities={capabilities}
            integrations={integrations}
            assignedIntegrations={assignedIntegrations}
            onApprovalChange={(value) => save({ approvals: value })}
            onCapabilitiesChange={(value) => save({ capabilities: value })}
            onIntegrationsChange={(value) => save({ integrations: value })}
          />
        ) : null}

        {activeTab === "channels" ? (
          <AgentChannelsTab
            agentId={agent.id}
            channels={sharedChannels}
            ready={ready}
            onUpdateChannelAgents={onUpdateChannelAgents}
          />
        ) : null}

        {activeTab === "permissions" ? (
          <AgentPermissionsTab
            permissions={toolPermissions}
            ready={ready}
            onChange={(value) => save({ toolPermissions: value })}
          />
        ) : null}
      </div>
    </div>
  );
}
function isDriverType(value: string): value is DriverType {
  return ["claude", "codex", "opencode", "remote"].includes(value);
}
