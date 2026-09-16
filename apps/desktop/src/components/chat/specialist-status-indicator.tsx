import type { SessionRecord } from "@chief/agent-runtime/types";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import {
  isWorkspaceAgentId,
  WORKSPACE_AGENT_IDENTITIES,
} from "../../lib/workspace-channels";
import { AgentAvatar } from "../agent-avatar";

export function specialistIsStartingOrWorking(status: SessionRecord["status"]) {
  return status === "idle" || status === "running" || status === "waiting";
}

export function SpecialistStatusIndicator({
  agent,
  className,
  size = 17,
  status,
}: {
  agent: string;
  className?: string;
  size?: number;
  status: SessionRecord["status"];
}) {
  if (status === "idle" || status === "running") {
    const color = isWorkspaceAgentId(agent)
      ? WORKSPACE_AGENT_IDENTITIES[agent].color
      : undefined;
    return (
      <MatrixLoader
        ariaLabel={status === "idle" ? "Starting" : "Working"}
        className={cn(
          "border-0 bg-transparent shadow-none [&_.matrix-loader-cell]:rounded-[24%]",
          color ? undefined : "text-slate-300",
          className,
        )}
        color={color}
        size={size}
      />
    );
  }
  const identity = isWorkspaceAgentId(agent)
    ? WORKSPACE_AGENT_IDENTITIES[agent]
    : undefined;
  return (
    <AgentAvatar
      className={cn("size-[17px] rounded-md", className)}
      label={identity?.name ?? agent}
    />
  );
}
