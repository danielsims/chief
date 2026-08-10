import type { ReactNode } from "react";
import { Hash, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

import type {
  AgentApprovalMode,
  AgentCapabilityId,
  AgentToolPermission,
  WorkspaceChannel,
} from "@chief/agent-runtime/types";
import { agentToolPermissionDefinitions } from "@chief/agent-runtime/agent-tool-permissions";
import { availableCapabilities } from "@chief/agent-runtime/capabilities";
import { Switch } from "@chief/ui/components/switch";
import { cn } from "@chief/ui/lib/utils";

export interface AgentIntegrationOption {
  provider: string;
  displayName: string;
}

const permissionGroups = [
  "Workspace",
  "Channels",
  "Messages",
  "Scheduled work",
  "Advanced",
] as const;

const capabilityDetails: Record<
  AgentCapabilityId,
  { label: string; description: string }
> = {
  "analytics-chart": {
    label: "Analytics charts",
    description: "Create visual reports from reliable workspace data.",
  },
  "prospect-memory": {
    label: "Prospect records",
    description: "Save qualified prospects with their source evidence.",
  },
  "trend-memory": {
    label: "Market signals",
    description: "Keep supported market and audience observations.",
  },
  "content-calendar": {
    label: "Content planning",
    description: "Create and update content drafts and schedules.",
  },
  "campaign-memory": {
    label: "Campaign planning",
    description: "Maintain campaign plans, decisions and current status.",
  },
  "schedule-manager": {
    label: "Scheduled work",
    description: "Turn goals into recurring or event-triggered work.",
  },
};

function SectionHeading({
  title,
  description,
  trailing,
}: {
  title: string;
  description: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-5">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          {description}
        </p>
      </div>
      {trailing}
    </div>
  );
}

function SettingGroup({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/25 divide-y divide-black/[0.055] overflow-hidden rounded-2xl dark:divide-white/[0.06]">
      {children}
    </div>
  );
}

function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">
          {description}
        </p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ApprovalControl({
  value,
  ready,
  onChange,
}: {
  value: AgentApprovalMode;
  ready: boolean;
  onChange: (value: AgentApprovalMode) => void;
}) {
  return (
    <div className="bg-background/70 grid w-52 grid-cols-2 rounded-xl p-0.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
      {(
        [
          { mode: "auto", label: "Automatic" },
          { mode: "ask", label: "Ask first" },
        ] as const
      ).map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          disabled={!ready}
          onClick={() => onChange(mode)}
          className={cn(
            "text-muted-foreground h-8 rounded-[10px] text-[11px] font-medium transition-[background-color,box-shadow,color] disabled:cursor-default",
            value === mode &&
              "bg-background text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08)]",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function AgentConfigurationTab({
  approvals,
  ready,
  capabilities,
  integrations,
  assignedIntegrations,
  onApprovalChange,
  onCapabilitiesChange,
  onIntegrationsChange,
}: {
  approvals: AgentApprovalMode;
  ready: boolean;
  capabilities: AgentCapabilityId[];
  integrations: AgentIntegrationOption[];
  assignedIntegrations: string[];
  onApprovalChange: (value: AgentApprovalMode) => void;
  onCapabilitiesChange: (value: AgentCapabilityId[]) => void;
  onIntegrationsChange: (value: string[]) => void;
}) {
  return (
    <div className="space-y-8">
      <section>
        <SectionHeading
          title="Tool approval"
          description="Choose whether approved tools run immediately or require confirmation."
        />
        <SettingGroup>
          <SettingRow
            title="Agent actions"
            description="Blocked tools remain unavailable in either mode."
            control={
              <ApprovalControl
                value={approvals}
                ready={ready}
                onChange={onApprovalChange}
              />
            }
          />
        </SettingGroup>
      </section>

      <section>
        <SectionHeading
          title="Workspace features"
          description="Optional Chief records and views this agent can work with."
        />
        <SettingGroup>
          {availableCapabilities.map((capability) => {
            const checked = capabilities.includes(capability.id);
            const detail = capabilityDetails[capability.id];
            return (
              <SettingRow
                key={capability.id}
                title={detail.label}
                description={detail.description}
                control={
                  <Switch
                    checked={checked}
                    disabled={!ready}
                    onCheckedChange={(next) =>
                      onCapabilitiesChange(
                        next
                          ? [...capabilities, capability.id]
                          : capabilities.filter((id) => id !== capability.id),
                      )
                    }
                  />
                }
              />
            );
          })}
        </SettingGroup>
      </section>

      <section>
        <SectionHeading
          title="Connections"
          description="Connected services this agent may use when its Executor permissions allow it."
          trailing={
            <Link
              to="/settings/integrations"
              className="text-muted-foreground hover:text-foreground text-[11px] transition-colors"
            >
              Manage integrations
            </Link>
          }
        />
        <SettingGroup>
          {integrations.length > 0 ? (
            integrations.map((integration) => {
              const checked = assignedIntegrations.includes(
                integration.provider,
              );
              return (
                <SettingRow
                  key={integration.provider}
                  title={integration.displayName}
                  description="Make this connected service available to the agent."
                  control={
                    <Switch
                      checked={checked}
                      disabled={!ready}
                      onCheckedChange={(next) =>
                        onIntegrationsChange(
                          next
                            ? [...assignedIntegrations, integration.provider]
                            : assignedIntegrations.filter(
                                (provider) => provider !== integration.provider,
                              ),
                        )
                      }
                    />
                  }
                />
              );
            })
          ) : (
            <div className="px-4 py-5">
              <p className="text-[13px] font-medium">No connected services</p>
              <p className="text-muted-foreground mt-1 text-[11px] leading-4">
                Add integrations at the workspace level before assigning them to
                this agent.
              </p>
            </div>
          )}
        </SettingGroup>
      </section>
    </div>
  );
}

export function AgentChannelsTab({
  agentId,
  channels,
  ready,
  onUpdateChannelAgents,
}: {
  agentId: string;
  channels: readonly WorkspaceChannel[];
  ready: boolean;
  onUpdateChannelAgents: (channelId: string, agentIds: string[]) => void;
}) {
  const assignedCount = channels.filter((channel) =>
    channel.agentIds.includes(agentId),
  ).length;

  return (
    <section>
      <SectionHeading
        title="Channel membership"
        description="Choose where this agent can join conversations and carry out work."
        trailing={
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {assignedCount} assigned
          </span>
        }
      />
      <SettingGroup>
        {channels.length > 0 ? (
          channels.map((channel) => {
            const assigned = channel.agentIds.includes(agentId);
            return (
              <div
                key={channel.id}
                className="flex min-h-[68px] items-center justify-between gap-6 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Hash size={15} className="text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {channel.name}
                    </p>
                    <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px] leading-4">
                      {channel.description || "Workspace channel"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={assigned}
                  disabled={!ready}
                  onCheckedChange={(next) =>
                    onUpdateChannelAgents(
                      channel.id,
                      next
                        ? [...channel.agentIds, agentId]
                        : channel.agentIds.filter(
                            (channelAgentId) => channelAgentId !== agentId,
                          ),
                    )
                  }
                />
              </div>
            );
          })
        ) : (
          <p className="text-muted-foreground px-4 py-5 text-xs">
            No shared channels yet.
          </p>
        )}
      </SettingGroup>
    </section>
  );
}

export function AgentPermissionsTab({
  permissions,
  ready,
  onChange,
}: {
  permissions: AgentToolPermission[];
  ready: boolean;
  onChange: (value: AgentToolPermission[]) => void;
}) {
  return (
    <div className="space-y-8">
      <div className="bg-muted/25 flex items-start gap-3.5 rounded-2xl px-4 py-4">
        <span className="bg-background/70 flex size-9 shrink-0 items-center justify-center rounded-full">
          <ShieldCheck size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium">Executor policy</p>
            <span className="text-muted-foreground text-[11px] tabular-nums">
              {permissions.length} of {agentToolPermissionDefinitions.length}{" "}
              enabled
            </span>
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl text-[11px] leading-5">
            Executor remains the tool gate. Chief verifies this agent's exact
            session identity and channel access before local work can run.
          </p>
        </div>
      </div>

      {permissionGroups.map((group) => {
        const definitions = agentToolPermissionDefinitions.filter(
          (permission) => permission.group === group,
        );
        const enabledCount = definitions.filter((permission) =>
          permissions.includes(permission.id),
        ).length;
        return (
          <section key={group}>
            <SectionHeading
              title={group}
              description={
                group === "Advanced"
                  ? "Sensitive capabilities that expand what this agent can operate."
                  : `Control this agent's ${group.toLowerCase()} access.`
              }
              trailing={
                <span className="text-muted-foreground text-[11px] tabular-nums">
                  {enabledCount} of {definitions.length}
                </span>
              }
            />
            <SettingGroup>
              {definitions.map((permission) => {
                const checked = permissions.includes(permission.id);
                return (
                  <SettingRow
                    key={permission.id}
                    title={permission.label}
                    description={permission.description}
                    control={
                      <Switch
                        checked={checked}
                        disabled={!ready}
                        onCheckedChange={(next) =>
                          onChange(
                            next
                              ? [...permissions, permission.id]
                              : permissions.filter(
                                  (item) => item !== permission.id,
                                ),
                          )
                        }
                      />
                    }
                  />
                );
              })}
            </SettingGroup>
          </section>
        );
      })}
    </div>
  );
}
