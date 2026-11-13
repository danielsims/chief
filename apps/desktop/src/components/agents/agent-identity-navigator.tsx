import { ChevronRight } from "lucide-react";

import type { AgentDefinition } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { AgentAvatar } from "../agent-avatar";

export function AgentIdentityNavigator({
  agent,
  selectedId,
  onSelect,
}: {
  agent: AgentDefinition;
  selectedId: string;
  onSelect: (agentId: string) => void;
}) {
  const profiles = [agent, ...(agent.subagents ?? [])];
  const selectRelative = (offset: number) => {
    const currentIndex = profiles.findIndex(
      (profile) => profile.id === selectedId,
    );
    const nextIndex = Math.min(
      profiles.length - 1,
      Math.max(0, currentIndex + offset),
    );
    onSelect(profiles[nextIndex]?.id ?? agent.id);
  };

  return (
    <aside className="lg:sticky lg:top-0">
      <p className="text-muted-foreground mb-2 px-2 text-[11px] font-medium">
        Agent
      </p>
      <div
        role="listbox"
        aria-label={`${agent.name} agent definitions`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            selectRelative(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            selectRelative(-1);
          }
        }}
        className="focus-visible:ring-ring overflow-hidden rounded-xl focus-visible:ring-2 focus-visible:outline-none"
      >
        {profiles.map((profile, index) => {
          const selected = profile.id === selectedId;
          return (
            <button
              key={profile.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(profile.id)}
              className={cn(
                "hover:bg-muted/55 flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left transition-colors",
                selected && "bg-muted/70",
              )}
            >
              <AgentAvatar
                agentId={profile.id}
                label={profile.name}
                className="size-7"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {profile.name}
                </span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {index === 0 ? "Root agent" : profile.role}
                </span>
              </span>
              {selected ? (
                <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-2 px-2 text-[11px] leading-4">
        Use ↑ and ↓ to move through this deployment.
      </p>
    </aside>
  );
}
