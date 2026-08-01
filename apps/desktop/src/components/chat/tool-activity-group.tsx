import { ChevronDown, ListChecks } from "lucide-react";

import type { ContentBlock } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { toolPresentation, toolSummary } from "./message-blocks";

export function ToolActivityGroup({
  blocks,
  progress = {},
  active,
}: {
  blocks: ContentBlock[];
  progress?: Record<string, string>;
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
  if (tools.length === 0) return null;
  const completed = tools.filter((tool) => results.has(tool.id)).length;
  const failed = tools.filter((tool) => results.get(tool.id)?.is_error).length;
  const working = active && completed < tools.length;

  return (
    <details
      className="group overflow-hidden rounded-xl bg-black/[0.018] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)] dark:bg-white/[0.018]"
      open={active || undefined}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-xs [&::-webkit-details-marker]:hidden">
        <ListChecks className="text-muted-foreground" size={14} />
        <span className="font-medium">
          {working ? "Working" : "Workspace activity"}
        </span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          {tools.length} {tools.length === 1 ? "step" : "steps"}
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
              : "Done"}
        </span>
        <ChevronDown
          size={12}
          className="text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-border/45 space-y-2 border-t px-3.5 py-3">
        {tools.map((tool) => {
          const result = results.get(tool.id);
          const label = toolPresentation(tool.name, tool.input);
          const summary = toolSummary(tool.input);
          const detail = summary.startsWith("const ") ? "" : summary;
          return (
            <div key={tool.id} className="flex min-w-0 items-center gap-2.5">
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
                  : active || progress[tool.id]
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
