import type { ContentBlock } from "@marketer/agent-runtime/types";
import { cn } from "@marketer/ui/lib/utils";

function toolSummary(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i.command === "string") return i.command;
  if (typeof i.file_path === "string") return String(i.file_path);
  if (typeof i.url === "string") return String(i.url);
  const first = Object.values(i).find((v) => typeof v === "string");
  return typeof first === "string" ? first.slice(0, 120) : "";
}

export function Blocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "text":
            return (
              <p key={i} className="whitespace-pre-wrap text-sm leading-6">
                {block.text}
              </p>
            );
          case "thinking":
            return (
              <p
                key={i}
                className="whitespace-pre-wrap border-l pl-3 text-xs italic leading-5 text-muted-foreground/70"
              >
                {block.thinking}
              </p>
            );
          case "tool_use":
            return (
              <div
                key={i}
                className={cn(
                  "flex items-baseline gap-2 border bg-accent/50 px-3 py-1.5 font-mono text-xs text-muted-foreground",
                )}
              >
                <span className="text-foreground">❯</span>
                <span className="shrink-0">{block.name}</span>
                <span className="truncate">{toolSummary(block.input)}</span>
              </div>
            );
          case "tool_result":
            return null;
          default:
            return null;
        }
      })}
    </div>
  );
}
