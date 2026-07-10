import type { ContentBlock } from "@marketer/agent-runtime/types";
import { cn } from "@marketer/ui/lib/utils";
import {
  ChevronDown,
  FilePenLine,
  FileText,
  Globe2,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";

const MAX_RESULT_CHARS = 3000;

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
  if (content && typeof content === "object") {
    return JSON.stringify(content, null, 2);
  }
  return "";
}

function canonicalTool(name: string) {
  const clean = name.replace(/^mcp__[^_]+__/, "").toLowerCase();
  if (clean.includes("search")) return "search";
  if (clean.includes("web") || clean.includes("fetch")) return "web";
  if (clean.includes("read")) return "read";
  if (clean.includes("edit") || clean.includes("write")) return "edit";
  if (clean.includes("bash") || clean.includes("command")) return "command";
  return "tool";
}

function toolPresentation(name: string) {
  const kind = canonicalTool(name);
  if (kind === "command") return { label: "Run", Icon: Terminal };
  if (kind === "search") return { label: "Search", Icon: Search };
  if (kind === "web") return { label: "Browse", Icon: Globe2 };
  if (kind === "read") return { label: "Read", Icon: FileText };
  if (kind === "edit") return { label: "Edit", Icon: FilePenLine };
  return { label: name.replace(/_/g, " "), Icon: Wrench };
}

export function toolSummary(input: unknown): string {
  const value = (input ?? {}) as Record<string, unknown>;
  for (const key of [
    "description",
    "file_path",
    "path",
    "command",
    "query",
    "url",
  ]) {
    if (typeof value[key] === "string" && value[key]) {
      const text = String(value[key]);
      return text.length > 90 ? `${text.slice(0, 90)}…` : text;
    }
  }
  return "";
}

function ToolCard({
  block,
  result,
}: {
  block: Extract<ContentBlock, { type: "tool_use" }>;
  result?: Extract<ContentBlock, { type: "tool_result" }>;
}) {
  const { label, Icon } = toolPresentation(block.name);
  const summary = toolSummary(block.input);
  const output = result ? toolResultText(result.content).trim() : "";
  const shownOutput =
    output.length > MAX_RESULT_CHARS
      ? `…${output.slice(-MAX_RESULT_CHARS)}`
      : output;
  const input =
    block.input && typeof block.input === "object"
      ? JSON.stringify(block.input, null, 2)
      : String(block.input ?? "");

  return (
    <details className="group border bg-card/50">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
        <Icon size={13} className="shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {summary}
        </span>
        {result ? (
          <span
            className={cn(
              "text-[10px]",
              result.is_error ? "text-red-500" : "text-muted-foreground",
            )}
          >
            {result.is_error ? "Failed" : "Done"}
          </span>
        ) : (
          <span className="size-1.5 animate-pulse bg-amber-400" />
        )}
        <ChevronDown
          size={12}
          className="text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        {input && input !== "{}" ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground">
            {input}
          </pre>
        ) : null}
        {shownOutput ? (
          <pre
            className={cn(
              "max-h-56 overflow-auto whitespace-pre-wrap break-words border-t pt-3 font-mono text-[11px] leading-5 text-muted-foreground",
              result?.is_error && "text-red-500",
            )}
          >
            {shownOutput}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

export function Blocks({ blocks }: { blocks: ContentBlock[] }) {
  const results = new Map(
    blocks
      .filter(
        (block): block is Extract<ContentBlock, { type: "tool_result" }> =>
          block.type === "tool_result",
      )
      .map((block) => [block.tool_use_id, block]),
  );

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "text":
            return (
              <p key={index} className="whitespace-pre-wrap text-sm leading-6">
                {block.text}
              </p>
            );
          case "thinking":
            return (
              <details
                key={index}
                className="group text-xs text-muted-foreground"
              >
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-1.5">
                    Reasoning
                    <ChevronDown
                      size={11}
                      className="transition-transform group-open:rotate-180"
                    />
                  </span>
                </summary>
                <p className="mt-2 whitespace-pre-wrap border-l pl-3 leading-5 text-muted-foreground/80">
                  {block.thinking}
                </p>
              </details>
            );
          case "tool_use":
            return (
              <ToolCard
                key={block.id}
                block={block}
                result={results.get(block.id)}
              />
            );
          case "tool_result": {
            if (
              blocks.some(
                (candidate) =>
                  candidate.type === "tool_use" &&
                  candidate.id === block.tool_use_id,
              )
            ) {
              return null;
            }
            const text = toolResultText(block.content).trim();
            if (!text) return null;
            return (
              <pre
                key={index}
                className={cn(
                  "max-h-56 overflow-auto whitespace-pre-wrap break-words border bg-card/50 px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground",
                  block.is_error && "border-red-500/40 text-red-500",
                )}
              >
                {text.length > MAX_RESULT_CHARS
                  ? `…${text.slice(-MAX_RESULT_CHARS)}`
                  : text}
              </pre>
            );
          }
        }
      })}
    </div>
  );
}
