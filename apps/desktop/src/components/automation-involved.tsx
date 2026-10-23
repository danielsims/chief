import type { ReactNode } from "react";

import type { WorkspaceSchedule } from "@chief/relay-contracts";
import { walkAutomation } from "@chief/relay-contracts";
import { cn } from "@chief/ui/lib/utils";

import { usePluginConnections } from "../lib/use-plugin-connections";
import { agentName } from "../pages/schedule-calendar-core";
import { AgentAvatar } from "./agent-avatar";
import { ProviderLogo } from "./provider-logo";

/**
 * The agents and plugins an automation involves, as one overlapping stack in
 * the order its steps use them.
 */
export function AutomationInvolved({
  schedule,
  className,
}: {
  schedule: WorkspaceSchedule;
  /** Sizes each mark, such as size-5. */
  className: string;
}) {
  const plugins = usePluginConnections();
  const ring = cn(
    "ring-background bg-background relative shrink-0 rounded-full ring-2",
    className,
  );
  const marks = new Map<string, ReactNode>();
  const addAgent = (agentId: string) =>
    marks.set(
      `agent:${agentId}`,
      <AgentAvatar
        agentId={agentId}
        label={agentName(agentId)}
        className={ring}
      />,
    );
  for (const { step } of walkAutomation(schedule.automation?.steps ?? [])) {
    if (step.type === "agent") addAgent(step.agentId);
    if (step.type !== "tool" || step.tool.source !== "plugin") continue;
    const { connectionId } = step.tool;
    const plugin = plugins.find((item) => item.id === connectionId);
    if (plugin?.domain)
      marks.set(
        `plugin:${plugin.id}`,
        <ProviderLogo
          domain={plugin.domain}
          label={plugin.name}
          className={ring}
        />,
      );
  }
  // An automation without steps runs as its team, from the brief.
  for (const agentId of [schedule.agentId, ...schedule.collaborators])
    if (!marks.has(`agent:${agentId}`)) addAgent(agentId);
  const shown = [...marks].slice(0, 6);
  return (
    <span className="flex items-center -space-x-1">
      {shown.map(([key, mark]) => (
        <span key={key} className="flex">
          {mark}
        </span>
      ))}
      {marks.size > shown.length ? (
        <span
          className={cn(
            ring,
            "bg-foreground/[0.06] text-muted-foreground flex items-center justify-center text-[9px] font-medium",
          )}
        >
          +{marks.size - shown.length}
        </span>
      ) : null}
    </span>
  );
}
