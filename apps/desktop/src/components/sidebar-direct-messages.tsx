import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceAgentId } from "../lib/workspace-channels";
import {
  WORKSPACE_AGENT_IDENTITIES,
  WORKSPACE_DIRECT_MESSAGES,
} from "../lib/workspace-channels";

export function SidebarDirectMessages({
  activeAgentId,
  directMessageIds,
  onOpen,
}: {
  activeAgentId: WorkspaceAgentId | null;
  directMessageIds: WorkspaceAgentId[];
  onOpen: (agentId: WorkspaceAgentId) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (directMessageIds.length === 0) return null;

  return (
    <section className="mt-3 px-0.5">
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
        className="text-sidebar-muted hover:text-sidebar-foreground group flex h-8 w-full items-center gap-1.5 px-2 text-left text-xs font-semibold transition-colors"
      >
        <span>Direct messages</span>
        <ChevronDown
          size={13}
          className={cn(
            "opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-visible:opacity-100",
            collapsed && "-rotate-90",
          )}
        />
      </button>
      {!collapsed ? (
        <div className="space-y-0.5">
          {WORKSPACE_DIRECT_MESSAGES.filter((message) =>
            directMessageIds.includes(message.id),
          ).map((message) => {
            const identity = WORKSPACE_AGENT_IDENTITIES[message.id];
            return (
              <button
                key={message.id}
                type="button"
                aria-current={activeAgentId === message.id ? "page" : undefined}
                onClick={() => onOpen(message.id)}
                className={cn(
                  "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors",
                  activeAgentId === message.id &&
                    "bg-sidebar-accent text-sidebar-foreground font-medium",
                )}
              >
                <span className="bg-sidebar-foreground text-sidebar flex size-4 shrink-0 items-center justify-center rounded-md text-[8px] font-semibold dark:bg-white dark:text-black">
                  {identity.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1 truncate">{identity.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
