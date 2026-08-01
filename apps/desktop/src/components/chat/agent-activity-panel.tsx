import { PanelRightClose } from "lucide-react";

import type { ContentBlock, SessionRecord } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import { ChiefMark } from "../chief-mark";
import { ToolActivityGroup } from "./tool-activity-group";

function taskAgentLabel(agent: string) {
  return agent === "brand"
    ? "Brand Researcher"
    : agent === "content"
      ? "Content Writer"
      : agent === "analyst"
        ? "Analyst"
        : agent === "prospector"
          ? "Prospector"
          : agent === "ads"
            ? "Ads Manager"
            : agent;
}

export function AgentActivityPanel({
  blocks,
  channelLabel,
  progress,
  running,
  statusLabel,
  tasks,
  onClose,
  onOpenTask,
}: {
  blocks: ContentBlock[];
  channelLabel: string;
  progress: Record<string, string>;
  running: boolean;
  statusLabel: string;
  tasks: SessionRecord[];
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const hasTools = blocks.some((block) => block.type === "tool_use");

  return (
    <aside className="border-border/60 bg-background flex h-full w-[min(360px,42vw)] shrink-0 flex-col border-l max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:w-[min(360px,calc(100%-24px))] max-lg:shadow-2xl">
      <header className="border-border/60 flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <h2 className="text-[13px] leading-4 font-semibold">Activity</h2>
          <p className="text-muted-foreground mt-0.5 truncate text-[11px] leading-4">
            Chief in #{channelLabel}
          </p>
        </div>
        <Button
          type="button"
          aria-label="Close activity"
          title="Close activity"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
        >
          <PanelRightClose size={15} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="bg-muted/35 flex items-center gap-3 rounded-xl px-3 py-3 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
          <span className="bg-foreground text-background flex size-7 shrink-0 items-center justify-center rounded-lg">
            <ChiefMark className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">Chief</p>
            <p
              className={
                running
                  ? "chief-shimmer-text mt-0.5 truncate text-[11px]"
                  : "text-muted-foreground mt-0.5 truncate text-[11px]"
              }
            >
              {running ? statusLabel : "Turn complete"}
            </p>
          </div>
          {running ? (
            <span className="relative flex size-2 shrink-0">
              <span className="bg-foreground/25 absolute inline-flex size-full animate-ping rounded-full" />
              <span className="bg-foreground/65 relative inline-flex size-2 rounded-full" />
            </span>
          ) : null}
        </div>

        <div className="mt-5">
          <p className="text-muted-foreground mb-2 px-1 text-[10px] font-medium">
            Current turn
          </p>
          {hasTools ? (
            <ToolActivityGroup
              blocks={blocks}
              progress={progress}
              active={running}
            />
          ) : (
            <p className="text-muted-foreground rounded-xl bg-black/[0.018] px-3 py-3 text-xs leading-5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)] dark:bg-white/[0.018]">
              {running
                ? "Chief is preparing a response. Detailed actions will appear here when tools or specialists are used."
                : "No tools were needed for this turn."}
            </p>
          )}
        </div>

        {tasks.length > 0 ? (
          <div className="mt-5">
            <p className="text-muted-foreground mb-2 px-1 text-[10px] font-medium">
              Specialists
            </p>
            <div className="space-y-1">
              {tasks.map((task) => {
                const active =
                  task.status === "running" || task.status === "waiting";
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpenTask?.(task.id)}
                    className="hover:bg-muted/45 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent)] transition-colors"
                  >
                    <span
                      className={
                        active
                          ? "size-1.5 shrink-0 animate-pulse rounded-full bg-blue-500"
                          : task.status === "failed"
                            ? "bg-destructive size-1.5 shrink-0 rounded-full"
                            : "size-1.5 shrink-0 rounded-full bg-emerald-500/80"
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {task.title}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block truncate text-[10px]">
                        {taskAgentLabel(task.agent)} ·{" "}
                        {active ? "Working" : task.status}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
