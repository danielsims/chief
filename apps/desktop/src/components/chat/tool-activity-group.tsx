import { Brain, ChevronDown, ListChecks } from "lucide-react";

import type { ContentBlock } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { toolPresentation, toolSummary } from "./message-blocks";

export function ToolActivityGroup({
  blocks,
  active,
}: {
  blocks: ContentBlock[];
  active: boolean;
}) {
  const results = new Map(
    blocks.flatMap((block) =>
      block.type === "tool_result" ? [[block.tool_use_id, block] as const] : [],
    ),
  );
  const seen = new Set<string>();
  const tools = blocks.flatMap((block) => {
    if (block.type !== "tool_use" || seen.has(block.id)) return [];
    seen.add(block.id);
    return [block];
  });
  const thoughts = blocks.filter((block) => block.type === "thinking");
  if (tools.length === 0 && thoughts.length === 0) return null;
  const completed = tools.filter((tool) => results.has(tool.id)).length;
  const failed = tools.filter((tool) => results.get(tool.id)?.is_error).length;
  const incomplete = tools.length - completed;
  const working = active && incomplete > 0;
  const stopped = !active && incomplete > 0;

  return (
    <details
      className="group w-96 max-w-full overflow-hidden rounded-xl bg-black/[0.018] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)] dark:bg-white/[0.018]"
      open={active || undefined}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-xs [&::-webkit-details-marker]:hidden">
        <ListChecks className="text-muted-foreground" size={14} />
        <span className="font-medium">
          {working
            ? "Working"
            : stopped
              ? "Stopped"
              : tools.length > 0
                ? "Workspace activity"
                : "Reasoning"}
        </span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          {tools.length > 0
            ? `${tools.length} ${tools.length === 1 ? "step" : "steps"}`
            : `${thoughts.length} ${thoughts.length === 1 ? "thought" : "thoughts"}`}
        </span>
        <span
          className={cn(
            "text-muted-foreground text-[10px]",
            failed > 0 && "text-red-400",
          )}
        >
          {failed > 0
            ? `${failed} failed`
            : working
              ? `${completed}/${tools.length}`
              : stopped
                ? `${completed}/${tools.length} complete`
                : "Done"}
        </span>
        <ChevronDown
          size={12}
          className="text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-border/45 space-y-2 border-t px-3.5 py-3">
        {blocks.map((block, index) => {
          if (block.type === "thinking") {
            const thought = block.thinking.trim();
            if (!thought) return null;
            return (
              <div
                key={`thought:${index}`}
                className="flex min-w-0 items-start gap-2.5"
              >
                <Brain
                  aria-hidden
                  className="text-muted-foreground mt-0.5 shrink-0"
                  size={13}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium">Thinking</span>
                  <p className="text-muted-foreground/80 mt-1 max-h-28 overflow-y-auto text-[11px] leading-5 [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {thought}
                  </p>
                </div>
              </div>
            );
          }
          if (block.type !== "tool_use" || seen.has(`render:${block.id}`)) {
            return null;
          }
          seen.add(`render:${block.id}`);
          const result = results.get(block.id);
          const label = toolPresentation(block.name, block.input);
          const summary = toolSummary(block.input);
          const detail = summary.startsWith("const ") ? "" : summary;
          return (
            <div key={block.id} className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  "bg-muted-foreground/40 size-1.5 shrink-0 rounded-full",
                  !result && active && "animate-pulse bg-blue-400",
                  result?.is_error && "bg-red-400",
                  result && !result.is_error && "bg-emerald-400/80",
                )}
              />
              <span className="shrink-0 text-xs">{label}</span>
              {detail ? (
                <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[10px]">
                  {detail}
                </span>
              ) : (
                <span className="flex-1" />
              )}
              <span className="text-muted-foreground shrink-0 text-[10px]">
                {result
                  ? result.is_error
                    ? "Failed"
                    : "Done"
                  : active
                    ? "Working"
                    : "Stopped"}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
