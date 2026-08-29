import {
  Brain,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  LoaderCircle,
} from "lucide-react";

import type { ContentBlock } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { formatActivityValue } from "./activity-tool-details";
import { toolPresentation, toolSummary } from "./message-blocks";

type ToolUseBlock = Extract<ContentBlock, { type: "tool_use" }>;
type ToolResultBlock = Extract<ContentBlock, { type: "tool_result" }>;

interface ActivityToolCall {
  tool: ToolUseBlock;
  result?: ToolResultBlock;
}

function activityToolCalls(
  blocks: readonly ContentBlock[],
): ActivityToolCall[] {
  const results = new Map<string, ToolResultBlock>();
  for (const block of blocks) {
    if (block.type === "tool_result") results.set(block.tool_use_id, block);
  }

  const seen = new Set<string>();
  const calls: ActivityToolCall[] = [];
  for (const block of blocks) {
    if (block.type !== "tool_use" || seen.has(block.id)) continue;
    seen.add(block.id);
    calls.push({ tool: block, result: results.get(block.id) });
  }
  return calls;
}

function ActivityDetail({
  label,
  value,
  error = false,
}: {
  label: string;
  value: string;
  error?: boolean;
}) {
  if (!value) return null;
  return (
    <section className="space-y-1.5">
      <p className="text-muted-foreground text-[11px] leading-4 font-medium">
        {label}
      </p>
      <pre
        className={cn(
          "bg-background/55 max-h-64 overflow-auto rounded-lg border px-2.5 py-2 font-mono text-[11px] leading-[1.55] [overflow-wrap:anywhere] break-all whitespace-pre-wrap",
          error
            ? "border-red-500/20 bg-red-500/[0.035] text-red-500"
            : "border-border/55 text-foreground/80",
        )}
      >
        {value}
      </pre>
    </section>
  );
}

function ActivityTool({
  call,
  active,
}: {
  call: ActivityToolCall;
  active: boolean;
}) {
  const { tool, result } = call;
  const running = !result && active;
  const failed = Boolean(result?.is_error);
  const stopped = !result && !active;
  const label = toolPresentation(tool.name, tool.input);
  const summary = toolSummary(tool.input);
  const parameters = formatActivityValue(tool.input);
  const output = formatActivityValue(result?.content);
  const state = failed
    ? "Failed"
    : running
      ? "Working"
      : stopped
        ? "Stopped"
        : "Done";

  return (
    <details
      className="group/tool border-border/45 border-t first:border-t-0"
      open={failed || running ? true : undefined}
    >
      <summary className="hover:bg-foreground/[0.025] flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3.5 py-2 transition-colors [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center",
            failed && "text-red-500",
            running && "text-blue-500",
            stopped && "text-muted-foreground",
            result && !failed && "text-emerald-500",
          )}
        >
          {failed ? (
            <CircleAlert size={13} />
          ) : running ? (
            <LoaderCircle className="animate-spin" size={13} />
          ) : stopped ? (
            <Circle size={11} />
          ) : (
            <Check size={13} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs leading-4 font-medium">
            {label}
          </span>
          {summary ? (
            <span className="text-muted-foreground block truncate text-[11px] leading-4">
              {summary}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "text-muted-foreground shrink-0 text-[11px] leading-4",
            failed && "text-red-500",
          )}
        >
          {state}
        </span>
        <ChevronDown
          size={12}
          className="text-muted-foreground shrink-0 transition-transform group-open/tool:rotate-180"
        />
      </summary>
      <div className="space-y-3 px-3.5 pt-1 pb-3.5 pl-10">
        <ActivityDetail label="Tool" value={tool.name} />
        <ActivityDetail label="Parameters" value={parameters} />
        {result ? (
          <ActivityDetail
            label={failed ? "Error" : "Result"}
            value={
              output ||
              (failed
                ? "The tool failed without an error message."
                : "Completed without output.")
            }
            error={failed}
          />
        ) : (
          <p className="text-muted-foreground text-[11px] leading-4">
            {running
              ? "Waiting for the tool to return."
              : "The run ended before this tool returned."}
          </p>
        )}
      </div>
    </details>
  );
}

function ActivityReasoning({ thoughts }: { thoughts: readonly string[] }) {
  if (thoughts.length === 0) return null;
  return (
    <details className="group/reasoning border-border/45 border-t" open>
      <summary className="hover:bg-foreground/[0.025] flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3.5 py-2 transition-colors [&::-webkit-details-marker]:hidden">
        <Brain size={14} className="text-muted-foreground shrink-0" />
        <span className="min-w-0 flex-1 text-xs leading-4 font-medium">
          Reasoning
        </span>
        <ChevronDown
          size={12}
          className="text-muted-foreground transition-transform group-open/reasoning:rotate-180"
        />
      </summary>
      <div className="border-muted ml-5 border-l-2 pr-3.5 pb-3.5 pl-4">
        <div className="text-muted-foreground max-h-72 space-y-3 overflow-y-auto text-[12px] leading-[1.55] font-normal [overflow-wrap:anywhere] whitespace-pre-wrap">
          {thoughts.map((thought, index) => (
            <p key={`${index}:${thought.slice(0, 24)}`}>{thought}</p>
          ))}
        </div>
      </div>
    </details>
  );
}

export function ToolActivityGroup({
  blocks,
  active,
}: {
  blocks: ContentBlock[];
  active: boolean;
}) {
  const calls = activityToolCalls(blocks);
  const thoughts = blocks.flatMap((block) => {
    if (block.type !== "thinking") return [];
    const thought = block.thinking.trim();
    return thought ? [thought] : [];
  });
  if (calls.length === 0 && thoughts.length === 0) return null;
  const completed = calls.filter((call) => call.result).length;
  const incomplete = calls.length - completed;
  const working = active && incomplete > 0;
  const stopped = !active && incomplete > 0;

  return (
    <details
      className="group w-96 max-w-full overflow-hidden rounded-xl bg-black/[0.018] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)] dark:bg-white/[0.018]"
      open
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-xs [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate font-medium">
          {working
            ? "Working"
            : stopped
              ? "Stopped"
              : calls.length > 0
                ? "Workspace activity"
                : "Reasoning"}
        </span>
        <span className="text-muted-foreground text-[12px] leading-4 font-normal">
          {working
            ? `${completed}/${calls.length}`
            : stopped
              ? `${completed}/${calls.length} complete`
              : "Done"}
        </span>
        <ChevronDown
          size={12}
          className="text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-border/45 border-t">
        {calls.map((call) => (
          <ActivityTool key={call.tool.id} call={call} active={active} />
        ))}
        <ActivityReasoning thoughts={thoughts} />
      </div>
    </details>
  );
}
