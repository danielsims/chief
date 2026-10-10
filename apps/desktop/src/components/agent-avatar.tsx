import type { ComponentType } from "react";
import { createContext, useContext } from "react";

import type { DriverType } from "@chief/agent-runtime/types";
import type { AgentAvatar as AgentAvatarValue } from "@chief/relay-contracts";
import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceAgentId } from "../lib/workspace-channels";
import { useAgentDriver } from "../lib/agent-config";
import {
  WORKSPACE_AGENT_IDENTITIES,
  workspaceAgentIdentity,
} from "../lib/workspace-channels";
import { AgentAvatarSprite } from "./agent-avatar-sprite";
import { ChiefMark } from "./chief-mark";

type ProviderMark = ComponentType<{ className?: string }>;

/**
 * What the app knows about how agents look: each agent's own avatar, and the
 * provider logos used when an on-device agent has none. The app supplies it,
 * so shared components never load workspace state or the icon library.
 */
export interface AgentAppearance {
  avatars: ReadonlyMap<string, AgentAvatarValue>;
  marks: Partial<Record<DriverType, ProviderMark>>;
}

export const AgentAppearanceContext = createContext<AgentAppearance>({
  avatars: new Map(),
  marks: {},
});

type Look =
  | AgentAvatarValue
  | { kind: "provider"; Mark: ProviderMark }
  | { kind: "mark"; color?: string };

/** The one place that decides how an agent is drawn: its own avatar, then its
 * provider's logo when it runs on this device, then Chief's mark. */
function useAgentLook(agentId: string | undefined, label: string): Look {
  const { avatars, marks } = useContext(AgentAppearanceContext);
  const identity = agentId
    ? workspaceAgentIdentity(agentId)
    : Object.values(WORKSPACE_AGENT_IDENTITIES).find(
        (candidate) => candidate.name.toLowerCase() === label.toLowerCase(),
      );
  const avatar = agentId ? avatars.get(agentId) : undefined;
  const driver = useAgentDriver(
    avatar || identity?.color ? undefined : agentId,
  );
  if (avatar) return avatar;
  const Mark = driver ? marks[driver] : undefined;
  if (Mark) return { kind: "provider", Mark };
  return { kind: "mark", color: identity?.color };
}

const avatarCorners = {
  circle: "rounded-full",
  rounded: "rounded-[28%]",
  square: "rounded-[14%]",
} as const;

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
  const look = useAgentLook(agentId, label);
  const frame = cn(
    "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden",
    look.kind === "style" ? avatarCorners[look.shape] : "rounded-[28%]",
    className,
  );
  switch (look.kind) {
    case "image":
      return (
        <span className={cn(frame, "bg-muted")} title={label}>
          <img src={look.url} alt="" className="size-full object-cover" />
        </span>
      );
    case "sprite":
      return (
        <span className={frame} title={label}>
          <AgentAvatarSprite sprite={look} />
        </span>
      );
    case "style":
      return (
        <span
          className={cn(frame, "text-[0.8em] font-semibold text-[#090909]")}
          style={{ backgroundColor: look.color }}
          title={label}
        >
          {look.glyph ?? (
            <ChiefMark
              className={cn("size-1/2", markClassName)}
              title={label}
            />
          )}
        </span>
      );
    case "provider":
      return (
        <span
          className={cn(
            frame,
            "bg-white text-black shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)]",
          )}
          title={label}
        >
          <look.Mark className={cn("size-3/5", markClassName)} />
        </span>
      );
    case "mark":
      return (
        <span
          style={
            look.color
              ? { backgroundColor: look.color, color: "#090909" }
              : undefined
          }
          className={cn(
            frame,
            "bg-foreground text-background shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--background)_12%,transparent),inset_0_1px_color-mix(in_srgb,var(--background)_10%,transparent)]",
          )}
        >
          <ChiefMark className={cn("size-1/2", markClassName)} title={label} />
        </span>
      );
  }
}
