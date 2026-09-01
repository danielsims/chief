import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceAgentId } from "../lib/workspace-channels";
import {
  WORKSPACE_AGENT_IDENTITIES,
  workspaceAgentIdentity,
} from "../lib/workspace-channels";
import { ChiefMark } from "./chief-mark";

export function AgentAvatar({
  className,
  agentId,
  label = "Chief agent",
  markClassName,
}: {
  className?: string;
  agentId?: WorkspaceAgentId;
  label?: string;
  markClassName?: string;
}) {
  const identity = agentId
    ? workspaceAgentIdentity(agentId)
    : Object.values(WORKSPACE_AGENT_IDENTITIES).find(
        (candidate) => candidate.name.toLowerCase() === label.toLowerCase(),
      );
  return (
    <span
      style={
        identity
          ? {
              backgroundColor: identity.color,
              color: "#090909",
            }
          : undefined
      }
      className={cn(
        "bg-foreground text-background inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--background)_12%,transparent),inset_0_1px_color-mix(in_srgb,var(--background)_10%,transparent)]",
        className,
      )}
    >
      <ChiefMark className={cn("size-1/2", markClassName)} title={label} />
    </span>
  );
}
