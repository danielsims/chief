import { useState } from "react";
import { MessageCircle, Trash2, X } from "lucide-react";
import { Link, useSearchParams } from "react-router";

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
import type { OwnedAgentControls } from "./owned-agent-sections";
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
import { agentSettingsProfile } from "../../lib/agent-settings-profile";
import { useWorkspaceRole } from "../../lib/workspace-role";
import { AgentAvatarEditor } from "./agent-avatar-editor";
import { AgentCredentialsCard } from "./agent-credentials-card";
import {
  AgentChannelsTab,
  AgentConfigurationTab,
  AgentPermissionsTab,
} from "./agent-detail-sections";
import { AgentExecutionCard } from "./agent-execution-card";
import { AgentIdentityNavigator } from "./agent-identity-navigator";
import { AgentMessageAccess } from "./agent-message-access";
import { AgentPluginAccess } from "./agent-plugin-access";
import { AgentNameEditor, OwnedAgentRuntimeCard } from "./owned-agent-sections";

type DetailTab = "configuration" | "channels" | "permissions";

const standardDetailTabs: readonly { id: DetailTab; label: string }[] = [
  { id: "configuration", label: "Configuration" },
  { id: "channels", label: "Channels" },
  { id: "permissions", label: "Permissions" },
];

export function AgentDetail({
  agent: rootAgent,
  workspaceId,
  preferences,
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
  onAgentChanged,
  selectedProfileId,
  onSelectProfile,
  owned,
}: {
  /** Set for an agent that joined from its own host. */
  owned?: OwnedAgentControls;
  agent: AgentDefinition;
  workspaceId: string | null;
  preferences: readonly AgentPreference[];
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
  onAgentChanged?: () => Promise<void>;
  selectedProfileId?: string;
  onSelectProfile?: (agentId: string) => void;
}) {
  // The tab lives in the URL so a remount (refocus, reconnect) keeps it.
  const [searchParams, setSearchParams] = useSearchParams();
  // Tool permissions are enforced by Chief's runtimes, which owned agents
  // don't use.
  const detailTabs = owned
    ? standardDetailTabs.filter((tab) => tab.id !== "permissions")
    : standardDetailTabs;
  const activeTab =
    detailTabs.find((tab) => tab.id === searchParams.get("tab"))?.id ??
    "configuration";
  const setActiveTab = (tab: DetailTab) =>
    setSearchParams(
      (current) => {
        current.set("tab", tab);
        return current;
      },
      { replace: true },
    );
  const [internalProfileId, setInternalProfileId] = useState(rootAgent.id);
  const requestedProfileId = selectedProfileId ?? internalProfileId;
  const activeProfileId =
    requestedProfileId === rootAgent.id ||
    rootAgent.subagents?.some((subagent) => subagent.id === requestedProfileId)
      ? requestedProfileId
      : rootAgent.id;
  const selectProfile = (nextId: string) => {
    setInternalProfileId(nextId);
    onSelectProfile?.(nextId);
  };
  const selectedSubagent = rootAgent.subagents?.find(
    (subagent) => subagent.id === activeProfileId,
  );
  const agent = agentSettingsProfile(rootAgent, activeProfileId);
  const override = preferences.find((entry) => entry.agentId === agent.id);
  const sharedDeployment = Boolean(
    selectedSubagent && rootAgent.runtime?.kind === "external-channel",
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
  const isOwner = useWorkspaceRole() === "owner";

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
      ...((patch.integrations ?? override?.integrations)
        ? { integrations: patch.integrations ?? override?.integrations }
        : undefined),
      toolPermissions: patch.toolPermissions ?? toolPermissions,
    });
  };

  return (
    <div className={cn("min-h-full", !enabled && "opacity-65")}>
      <div
        className={cn(
          rootAgent.subagents?.length &&
            "grid items-start gap-8 lg:grid-cols-[210px_minmax(0,1fr)]",
        )}
      >
        {rootAgent.subagents?.length ? (
          <AgentIdentityNavigator
            agent={rootAgent}
            selectedId={activeProfileId}
            onSelect={selectProfile}
          />
        ) : null}
        <div className="max-w-4xl min-w-0">
          <>
            <header>
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="flex min-w-0 items-center gap-4">
                  <AgentAvatarEditor
                    agentId={agent.id}
                    agentName={agent.name}
                    relayClient={relayClient}
                    ready={ready}
                    onChanged={onAgentChanged}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {owned ? (
                        <AgentNameEditor
                          name={agent.name}
                          onRename={owned.onRename}
                        />
                      ) : (
                        <h2 className="truncate text-[26px] leading-none font-normal tracking-[-0.04em]">
                          {agent.name}
                        </h2>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1.5 text-xs">
                      {agent.role}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {owned ? null : (
                    <>
                      <label className="text-muted-foreground mr-1 flex items-center gap-2 text-[11px]">
                        {enabled ? "Active" : "Paused"}
                        <Switch
                          checked={enabled}
                          disabled={
                            !ready || agent.runtime?.kind === "external-channel"
                          }
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
                    </>
                  )}
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
              {activeTab === "configuration" && owned ? (
                <div className="space-y-10">
                  <OwnedAgentRuntimeCard
                    name={agent.name}
                    online={owned.online}
                    lastSeenAt={owned.lastSeenAt}
                  />
                  <AgentDangerZone
                    agent={agent}
                    ready={ready}
                    onRemove={onRemove}
                    disconnect
                  />
                </div>
              ) : activeTab === "configuration" ? (
                <div className="space-y-10">
                  <div className="space-y-4">
                    {sharedDeployment ? (
                      <section className="bg-muted/25 rounded-2xl p-4">
                        <h3 className="text-sm font-medium">
                          Runtime and model
                        </h3>
                        <p className="text-muted-foreground mt-1 text-[13px] leading-5">
                          {agent.name} shares {rootAgent.name}'s Vercel Eve
                          deployment and model.
                        </p>
                        <Button
                          className="mt-3"
                          size="sm"
                          variant="outline"
                          onClick={() => selectProfile(rootAgent.id)}
                        >
                          Manage {rootAgent.name}'s runtime
                        </Button>
                      </section>
                    ) : (
                      <AgentExecutionCard
                        key={agent.id}
                        agent={agent}
                        execution={execution}
                        ready={ready}
                        saving={saving}
                        error={preferenceError}
                        relayClient={relayClient}
                        onExternalAgentChanged={onAgentChanged}
                        onApply={(draft) =>
                          save({
                            deploymentTarget: relayDeploymentTarget(
                              draft.deployment,
                            ),
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
                    )}
                    {isOwner &&
                    relayClient &&
                    execution.deployment.kind === "chief-cloud" &&
                    execution.inference.kind === "configured" ? (
                      <AgentCredentialsCard
                        provider={execution.inference.provider}
                        relayClient={relayClient}
                      />
                    ) : null}
                  </div>
                  <AgentPluginAccess
                    client={relayClient}
                    assigned={override?.integrations ?? []}
                    asksBeforeActing={approvals !== "auto"}
                    ready={ready}
                    onChange={(integrations) => save({ integrations })}
                  />
                  <AgentConfigurationTab
                    approvals={approvals}
                    ready={ready}
                    onApprovalChange={(value) => save({ approvals: value })}
                  />
                  {selectedSubagent ? (
                    <section>
                      <h3 className="text-sm font-medium">Instructions</h3>
                      <pre className="bg-muted/25 mt-3 max-h-[52vh] overflow-auto rounded-2xl p-4 font-sans text-[13px] leading-6 whitespace-pre-wrap">
                        {agent.instructions}
                      </pre>
                    </section>
                  ) : (
                    <AgentDangerZone
                      agent={agent}
                      ready={ready}
                      onRemove={onRemove}
                    />
                  )}
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
                  {execution.deployment.kind === "on-device" ? (
                    <AgentMessageAccess
                      agentId={agent.id}
                      client={relayClient}
                    />
                  ) : null}
                  <AgentPermissionsTab
                    permissions={toolPermissions}
                    ready={ready}
                    onChange={(value) => save({ toolPermissions: value })}
                  />
                </>
              ) : null}
            </div>
          </>
        </div>
      </div>
    </div>
  );
}

function AgentDangerZone({
  agent,
  ready,
  onRemove,
  disconnect = false,
}: {
  agent: AgentDefinition;
  ready: boolean;
  onRemove: (agentId: string) => Promise<void>;
  /** An owned agent is disconnected, not deleted: it lives on its own host. */
  disconnect?: boolean;
}) {
  const copy = disconnect
    ? {
        heading: "Disconnect agent",
        action: `Disconnect ${agent.name}`,
        summary:
          "Revokes its access to this workspace. It can ask to join again with a new invite.",
        confirm: `${agent.name} loses access to every channel straight away. It can ask to join again with a new invite. Type the agent name to confirm.`,
        button: "Disconnect agent",
        submit: "Disconnect",
        pending: "Disconnecting...",
      }
    : {
        heading: "Delete agent",
        action: `Delete ${agent.name}`,
        summary:
          "Deletes the agent, its conversations, and associated project records. External Git repositories and deployments remain.",
        confirm:
          "This permanently deletes the agent, its conversations, and its associated project records from Chief. External Git repositories and deployments remain. Type the agent name to confirm.",
        button: "Delete agent",
        submit: "Delete permanently",
        pending: "Deleting...",
      };
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
          : `Chief couldn't ${disconnect ? "disconnect" : "remove"} this agent.`,
      );
      setRemoving(false);
    }
  };

  return (
    <section>
      <h3 className="text-destructive text-sm font-medium">{copy.heading}</h3>
      <div className="border-destructive/30 mt-3 flex items-center justify-between gap-6 rounded-2xl border px-4 py-4">
        <div>
          <p className="text-[13px] font-medium">{copy.action}</p>
          <p className="text-muted-foreground mt-1 text-[13px] leading-5 font-normal">
            {copy.summary}
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
          {copy.button}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.action}</DialogTitle>
            <DialogDescription>{copy.confirm}</DialogDescription>
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
              {removing ? copy.pending : copy.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
