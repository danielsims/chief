import { useState } from "react";
import { MessageCircle, Trash2, X } from "lucide-react";
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
import type { RelayClient } from "@chief/relay-client";
import { effectiveAgentToolPermissions } from "@chief/agent-runtime/agent-tool-permissions";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import { Switch } from "@chief/ui/components/switch";
import { cn } from "@chief/ui/lib/utils";

import type { AgentOverride as LocalAgentOverride } from "../../lib/agent-overrides";
import type { AgentIntegrationOption } from "./agent-detail-sections";
import {
  agentExecution,
  relayDeploymentTarget,
} from "../../lib/agent-execution";
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
import {
  AgentIdentityNavigator,
  SubagentDetail,
} from "./agent-identity-navigator";
import { AgentMessageAccess } from "./agent-message-access";

export type { AgentIntegrationOption } from "./agent-detail-sections";

type DetailTab = "configuration" | "channels" | "permissions";

const standardDetailTabs: readonly { id: DetailTab; label: string }[] = [
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
  onRemove,
  relayClient,
  onExternalAgentChanged,
  selectedProfileId,
  onSelectProfile,
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
  onRemove: (agentId: string) => Promise<void>;
  relayClient?: RelayClient | null;
  onExternalAgentChanged?: () => Promise<void>;
  selectedProfileId?: string;
  onSelectProfile?: (agentId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("configuration");
  const [internalProfileId, setInternalProfileId] = useState(agent.id);
  const requestedProfileId = selectedProfileId ?? internalProfileId;
  const activeProfileId =
    requestedProfileId === agent.id ||
    agent.subagents?.some((subagent) => subagent.id === requestedProfileId)
      ? requestedProfileId
      : agent.id;
  const selectProfile = (nextId: string) => {
    setInternalProfileId(nextId);
    onSelectProfile?.(nextId);
  };
  const selectedSubagent = agent.subagents?.find(
    (subagent) => subagent.id === activeProfileId,
  );
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
  const execution = agentExecution({
    runtime: agent.runtime,
    deploymentTarget,
    provider: driver,
    model,
  });

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
      <div
        className={cn(
          agent.subagents?.length &&
            "grid items-start gap-8 lg:grid-cols-[210px_minmax(0,1fr)]",
        )}
      >
        {agent.subagents?.length ? (
          <AgentIdentityNavigator
            agent={agent}
            selectedId={activeProfileId}
            onSelect={selectProfile}
          />
        ) : null}
        <div className="min-w-0">
          {selectedSubagent ? (
            <SubagentDetail profile={selectedSubagent} parent={agent} />
          ) : (
            <>
              <header>
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="flex min-w-0 items-center gap-4">
                    <DetailAgentAvatar name={agent.name} enabled={enabled} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-[26px] leading-none font-normal tracking-[-0.04em]">
                          {agent.name}
                        </h2>
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
                        onCheckedChange={(checked) =>
                          save({ enabled: checked })
                        }
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
                  agent={agent}
                  execution={execution}
                  ready={ready}
                  saving={saving}
                  error={preferenceError}
                  relayClient={relayClient}
                  onExternalAgentChanged={onExternalAgentChanged}
                  onApply={(draft) =>
                    save({
                      deploymentTarget: relayDeploymentTarget(draft.deployment),
                      driver: draft.provider,
                      model: draft.model,
                    })
                  }
                  onApplyToTeam={(draft) =>
                    onApplyExecutionToTeam(
                      relayDeploymentTarget(draft.deployment),
                      draft.provider,
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
                {standardDetailTabs.map((tab) => {
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
                  <div className="space-y-10">
                    <AgentConfigurationTab
                      approvals={approvals}
                      ready={ready}
                      capabilities={capabilities}
                      integrations={integrations}
                      assignedIntegrations={assignedIntegrations}
                      onApprovalChange={(value) => save({ approvals: value })}
                      onCapabilitiesChange={(value) =>
                        save({ capabilities: value })
                      }
                      onIntegrationsChange={(value) =>
                        save({ integrations: value })
                      }
                    />
                    <AgentDangerZone
                      agent={agent}
                      ready={ready}
                      onRemove={onRemove}
                    />
                  </div>
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
                  <>
                    <AgentMessageAccess
                      agentId={agent.id}
                      client={relayClient}
                    />
                    <AgentPermissionsTab
                      permissions={toolPermissions}
                      ready={ready}
                      onChange={(value) => save({ toolPermissions: value })}
                    />
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentDangerZone({
  agent,
  ready,
  onRemove,
}: {
  agent: AgentDefinition;
  ready: boolean;
  onRemove: (agentId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await onRemove(agent.id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Chief couldn't remove this agent.",
      );
      setRemoving(false);
    }
  };

  return (
    <section>
      <h3 className="text-destructive text-sm font-medium">Delete agent</h3>
      <div className="border-destructive/30 mt-3 flex items-center justify-between gap-6 rounded-2xl border px-4 py-4">
        <div>
          <p className="text-[13px] font-medium">Delete {agent.name}</p>
          <p className="text-muted-foreground mt-1 text-[13px] leading-5 font-normal">
            Deletes the agent, its conversations, and associated project
            records. External Git repositories and deployments remain.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          disabled={!ready}
          onClick={() => {
            setConfirmation("");
            setError(null);
            setOpen(true);
          }}
        >
          <Trash2 size={13} />
          Delete agent
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {agent.name}</DialogTitle>
            <DialogDescription>
              This permanently deletes the agent, its conversations, and its
              associated project records from Chief. External Git repositories
              and deployments remain. Type the agent name to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={agent.name}
          />
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={confirmation !== agent.name || removing}
              onClick={() => void remove()}
            >
              {removing ? "Deleting..." : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
