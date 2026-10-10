import type { ComponentType } from "react";
import { createContext, useContext } from "react";

import type { DriverType } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceAgentId } from "../lib/workspace-channels";
import { useAgentDriver } from "../lib/agent-config";
import {
  WORKSPACE_AGENT_IDENTITIES,
  workspaceAgentIdentity,
} from "../lib/workspace-channels";
import { ChiefMark } from "./chief-mark";

type ProviderMark = ComponentType<{ className?: string }>;

/** Provider logos for agents that run on this device, supplied by the app so
 * shared components do not load the icon library themselves. */
export const ProviderMarksContext = createContext<
  Partial<Record<DriverType, ProviderMark>>
>({});

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
  // An agent you add to run on this device wears its provider's mark, so
  // Claude Code, ChatGPT and OpenCode are recognisable at a glance. Chief's
  // own agents keep their colours.
  const driver = useAgentDriver(identity?.color ? undefined : agentId);
  const marks = useContext(ProviderMarksContext);
  const ProviderMark = driver ? marks[driver] : undefined;
  if (ProviderMark) {
    return (
      <span
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[28%] bg-white text-black shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)]",
          className,
        )}
        title={label}
      >
        <ProviderMark className={cn("size-3/5", markClassName)} />
      </span>
    );
  }
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
        "bg-foreground text-background inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[28%] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--background)_12%,transparent),inset_0_1px_color-mix(in_srgb,var(--background)_10%,transparent)]",
        className,
      )}
    >
      <ChiefMark className={cn("size-1/2", markClassName)} title={label} />
    </span>
  );
}
