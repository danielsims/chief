import type { ReactNode } from "react";
import { Check, ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";

import type { ContentBlock } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { relativeActivityTime } from "./relative-activity-time";
import { ToolActivityGroup } from "./tool-activity-group";

/**
 * One prompt in the Activity panel: a single line to scan, which opens to
 * the reasoning and tool steps the agent took for it.
 */
export function ActivityTurnRow({
  prompt,
  at,
  blocks,
  toolTimes,
  working,
  failed,
  expanded,
  onToggle,
  notice,
}: {
  prompt: string;
  at?: number;
  blocks: ContentBlock[];
  toolTimes?: ReadonlyMap<string, number>;
  working: boolean;
  failed: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** A failure or stop, shown with the steps. */
  notice?: ReactNode;
}) {
  const steps = blocks.filter((block) => block.type === "tool_use").length;
  const stepLabel = `${steps} ${steps === 1 ? "step" : "steps"}`;
  const summary = working
    ? steps > 0
      ? `Working · ${stepLabel}`
      : "Working"
    : failed
      ? "Stopped"
      : steps > 0
        ? stepLabel
        : "Answered directly";
  const hasDetail = blocks.length > 0 || Boolean(notice);
  return (
    <section className="border-border/60 border-b last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasDetail}
        aria-expanded={hasDetail ? expanded : undefined}
        className="hover:bg-muted/40 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center",
            working && "text-foreground",
            failed && !working && "text-red-500",
            !working && !failed && "text-muted-foreground/70",
          )}
        >
          {working ? (
            <LoaderCircle size={13} className="animate-spin" />
          ) : failed ? (
            <CircleAlert size={13} />
          ) : (
            <Check size={13} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm leading-5">
            {prompt || "Agent activity"}
          </span>
          <span
            className={cn(
              "text-muted-foreground mt-0.5 block text-xs",
              working && "chief-shimmer-text",
            )}
          >
            {summary}
          </span>
        </span>
        <time className="text-muted-foreground shrink-0 pt-0.5 text-xs">
          {relativeActivityTime(at)}
        </time>
        {hasDetail ? (
          <ChevronDown
            size={13}
            className={cn(
              "text-muted-foreground mt-1 shrink-0 transition-transform",
              expanded && "rotate-180",
            )}
          />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
      </button>
      {expanded && hasDetail ? (
        <div className="space-y-2 pr-3 pb-3 pl-9">
          {blocks.length > 0 ? (
            <ToolActivityGroup
              flat
              blocks={blocks}
              toolTimes={toolTimes}
              active={working}
            />
          ) : null}
          {notice}
        </div>
      ) : null}
    </section>
  );
}
