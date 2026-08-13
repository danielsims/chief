import type { SessionRecord } from "@chief/agent-runtime/types";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import { WORKSPACE_AGENT_IDENTITIES } from "../../lib/workspace-channels";
import { AgentAvatar } from "../agent-avatar";

const AGENT_WORKING_COLOR: Record<string, string> = {
  brand: "text-foreground",
  prospector: "text-sky-300",
  content: "text-amber-300",
  analyst: "text-cyan-300",
  ads: "text-rose-300",
  setup: "text-emerald-300",
  engineer: "text-orange-300",
};

export function specialistIsStartingOrWorking(status: SessionRecord["status"]) {
  return status === "idle" || status === "running" || status === "waiting";
}

export function SpecialistStatusIndicator({
  agent,
  className,
  status,
}: {
  agent: string;
  className?: string;
  status: SessionRecord["status"];
}) {
  if (status === "idle" || status === "running") {
    return (
      <MatrixLoader
        ariaLabel={status === "idle" ? "Starting" : "Working"}
        className={cn(
          "border-0 bg-transparent shadow-none [&_.matrix-loader-cell]:rounded-[24%]",
          AGENT_WORKING_COLOR[agent] ?? "text-slate-300",
          className,
        )}
        size={17}
      />
    );
  }
  if (status === "waiting" || status === "failed" || status === "completed") {
    const identity = Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, agent)
      ? WORKSPACE_AGENT_IDENTITIES[agent as WorkspaceAgentId]
      : undefined;
    return (
      <AgentAvatar
        className={cn("size-[17px] rounded-md", className)}
        label={identity?.name ?? agent}
      />
    );
  }
  return null;
}
