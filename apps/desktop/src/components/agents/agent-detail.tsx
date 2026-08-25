import { useState } from "react";
import { MessageCircle, X } from "lucide-react";
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
import { Switch } from "@chief/ui/components/switch";
import { cn } from "@chief/ui/lib/utils";

import type { AgentOverride as LocalAgentOverride } from "../../lib/agent-overrides";
import type { AgentIntegrationOption } from "./agent-detail-sections";
import {
  getToolApprovals,
  getWorkspaceProvider,
  setAgentOverride,
  setWorkspaceProvider,
} from "../../lib/agent-overrides";
import { AgentAvatar as ChiefAgentAvatar } from "../agent-avatar";
import {
  AgentChannelsTab,
  AgentConfigurationTab,
  AgentPermissionsTab,
} from "./agent-detail-sections";
import { AgentExecutionCard } from "./agent-execution-card";

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
  onApplyExecutionToTeam: (
    deploymentTarget: "phone" | "desktop" | "cloud",
    driver: DriverType,
    model?: string,
  ) => void;
  onClose?: () => void;
  onUpdateChannelAgents: (channelId: string, agentIds: string[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("configuration");
  const enabled = override?.enabled ?? true;
  const driver = override
    ? (override.driver ?? null)
    : getWorkspaceProvider(workspaceId);
  const model = override?.model ?? "";
  const deploymentTarget =
    override?.deploymentTarget ?? (driver === "remote" ? "cloud" : "desktop");
  const approvals = override?.approvals ?? getToolApprovals(workspaceId);
  const capabilities = override?.capabilities ?? agent.capabilities ?? [];
  const assignedIntegrations =
    override?.integrations ?? integrations.map((item) => item.provider);
  const toolPermissions = effectiveAgentToolPermissions(
    agent.id,
    override?.toolPermissions,
  );
  const sharedChannels = channels.filter(
    (channel) => channel.visibility !== "direct",
  );

  const save = (patch: {
    enabled?: boolean;
    deploymentTarget?: "phone" | "desktop" | "cloud";
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
      deploymentTarget: patch.deploymentTarget ?? deploymentTarget,
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

        <AgentExecutionCard
          agentName={agent.name}
          deploymentTarget={deploymentTarget}
          driver={driver}
          model={model}
          ready={ready}
          saving={saving}
          error={preferenceError}
          onApply={save}
          onApplyToTeam={(draft) =>
            onApplyExecutionToTeam(
              draft.deploymentTarget,
              draft.driver,
              draft.model,
            )
          }
        />
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
