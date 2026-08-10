import { useState } from "react";
import { Cloud, MessageCircle, X } from "lucide-react";
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
  onSave,
  onClose,
  onDeploy,
  onUpdateChannelAgents,
}: {
  agent: AgentDefinition;
  workspaceId: string | null;
  override: AgentPreference | undefined;
  integrations: AgentIntegrationOption[];
  channels: readonly WorkspaceChannel[];
  ready: boolean;
  onSave: (preference: AgentPreference) => void;
  onClose?: () => void;
  onDeploy?: () => void;
  onUpdateChannelAgents: (channelId: string, agentIds: string[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("configuration");
  const enabled = override?.enabled ?? true;
  const driver = override?.driver ?? getWorkspaceProvider(workspaceId);
  const models = useProviderModels(driver);
  const model = override?.model ?? "";
  const approvals = override?.approvals ?? getToolApprovals(workspaceId);
  const capabilities = override?.capabilities ?? agent.capabilities ?? [];
  const assignedIntegrations =
    override?.integrations ?? integrations.map((item) => item.provider);
  const toolPermissions = effectiveAgentToolPermissions(
    agent.id,
    override?.toolPermissions,
  );
  const meta = driver ? PROVIDER_META[driver] : null;
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
            {onDeploy ? (
              <Button variant="outline" size="sm" onClick={onDeploy}>
                <Cloud size={13} />
                Deploy
              </Button>
            ) : null}
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

        <div className="bg-muted/25 mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl px-4 py-3.5">
          <div>
            <p className="text-[13px] font-medium">Agent app and model</p>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              {meta
                ? `${agent.name} runs through ${meta.label}.`
                : "Choose the local agent app that runs this agent."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={driver ?? undefined}
              disabled={!ready}
              onValueChange={(value) =>
                save({ driver: value as DriverType, model: "" })
              }
            >
              <SelectTrigger className="bg-background/70 h-9 w-auto min-w-40 rounded-xl px-2.5 text-xs">
                {meta ? (
                  <span className="flex items-center gap-2">
                    <meta.Icon size={14} />
                    {meta.label}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Choose agent app
                  </span>
                )}
              </SelectTrigger>
              <SelectContent className="min-w-40">
                <SelectGroup>
                  <SelectLabel>Local agent apps</SelectLabel>
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
                <SelectTrigger className="bg-background/70 h-9 w-auto max-w-56 min-w-40 rounded-xl px-2.5 text-xs">
                  <span className="truncate">
                    {models.loading
                      ? "Loading…"
                      : (models.models.find((item) => item.value === model)
                          ?.label ??
                          model) ||
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
