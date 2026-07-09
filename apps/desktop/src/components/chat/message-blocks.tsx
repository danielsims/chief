import type { ContentBlock } from "@marketer/agent-runtime/types";
import { cn } from "@marketer/ui/lib/utils";

const MAX_RESULT_CHARS = 1600;

/** Tool results come back as a string or an array of text blocks. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block &&
        typeof block === "object" &&
        "text" in block &&
        typeof (block as { text: unknown }).text === "string"
          ? (block as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function toolSummary(input: unknown): string {
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
          case "tool_result": {
            const text = toolResultText(block.content).trim();
            if (!text) return null;
            const shown =
              text.length > MAX_RESULT_CHARS
                ? `…${text.slice(-MAX_RESULT_CHARS)}`
                : text;
            return (
              <pre
                key={i}
                className={cn(
                  "max-h-44 overflow-y-auto whitespace-pre-wrap break-words border bg-background/60 px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground",
                  block.is_error && "border-destructive/40 text-destructive/90",
                )}
              >
                {shown}
              </pre>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}
