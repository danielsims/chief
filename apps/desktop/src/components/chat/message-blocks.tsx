import { Fragment, useEffect, useState } from "react";
import type {
  AgentCapabilityId,
  ContentBlock,
} from "@marketer/agent-runtime/types";
import { cn } from "@marketer/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { renderGenerativePart } from "../generative-ui/registry";
import { StreamingMarkdown } from "./streaming-markdown";

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
  if (clean === "skill" || clean === "skills" || clean.includes("skill")) {
    return "skill";
  }
  if (clean === "execute" || clean.endsWith("__execute")) return "integration";
  if (clean.includes("search")) return "search";
  if (clean.includes("web") || clean.includes("fetch")) return "web";
  if (clean.includes("read")) return "read";
  if (clean.includes("edit") || clean.includes("write")) return "edit";
  if (clean.includes("bash") || clean.includes("command")) return "command";
  return "tool";
}

function skillName(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  for (const key of ["name", "skill", "skillName"]) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }
  return null;
}

function executorToolLabel(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const code = (input as Record<string, unknown>).code;
  if (typeof code !== "string") return null;
  const calls = Array.from(
    code.matchAll(/agentTools\.([A-Za-z0-9_]+)\s*\(/g),
    (match) => match[1],
  );
  if (calls.includes("uiPresentChart")) return "Present chart";
  const reports = calls.filter((call) => call === "analyticsRunReport");
  if (reports.length > 1) return "Compare analytics periods";
  if (reports.length === 1) return "Fetch analytics report";
  if (calls.includes("sourcesList")) return "Check connected sources";
  const first = calls[0];
  return first
    ? first
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/^./, (character) => character.toUpperCase())
    : null;
}

function toolPresentation(name: string, input: unknown) {
  const kind = canonicalTool(name);
  if (kind === "skill") return skillName(input) ?? "Skill";
  if (kind === "integration") {
    return executorToolLabel(input) ?? "Run connected tool";
  }
  if (kind === "command") return "Run";
  if (kind === "search") return "Search";
  if (kind === "web") return "Browse";
  if (kind === "read") return "Read";
  if (kind === "edit") return "Edit";
  return name.replace(/_/g, " ");
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
    "code",
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
  progress,
}: {
  block: Extract<ContentBlock, { type: "tool_use" }>;
  result?: Extract<ContentBlock, { type: "tool_result" }>;
  progress?: string;
}) {
  const kind = canonicalTool(block.name);
  const label = toolPresentation(block.name, block.input);
  const summary = toolSummary(block.input);
  const output = result
    ? toolResultText(result.content).trim()
    : (progress?.trim() ?? "");
  const shownOutput =
    output.length > MAX_RESULT_CHARS
      ? `…${output.slice(-MAX_RESULT_CHARS)}`
      : output;
  const warning = Boolean(
    result && !result.is_error && /\bwarn(?:ing)?\b/i.test(output),
  );
  const input =
    block.input && typeof block.input === "object"
      ? JSON.stringify(block.input, null, 2)
      : String(block.input ?? "");

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (result) return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [result]);

  if (kind === "skill") {
    return (
      <div className="flex min-w-0 max-w-full items-center gap-2.5 border bg-card/50 px-3 py-2 text-xs">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            !result && "animate-pulse bg-blue-500",
            result?.is_error ? "bg-red-500" : result && "bg-emerald-500",
          )}
        />
        <span className="shrink-0 font-medium">Skill</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "shrink-0 text-[10px] text-muted-foreground",
            result?.is_error && "text-red-500",
          )}
        >
          {result ? (result.is_error ? "Failed" : "Done") : "Loading"}
        </span>
      </div>
    );
  }

  return (
    <details className="group min-w-0 max-w-full overflow-hidden border bg-card/50">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            !result && "animate-pulse bg-blue-500",
            result?.is_error && "bg-red-500",
            result && !result.is_error && warning && "bg-amber-400",
            result && !result.is_error && !warning && "bg-emerald-500",
          )}
        />
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
          <span className="text-[10px] text-muted-foreground">
            {elapsed >= 30 ? "Still working" : "Running"} · {elapsed}s
          </span>
        )}
        <ChevronDown
          size={12}
          className="text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        {input && input !== "{}" ? (
          <pre className="max-h-40 max-w-full overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {input}
          </pre>
        ) : null}
        {shownOutput ? (
          <pre
            className={cn(
              "max-h-56 max-w-full overflow-auto whitespace-pre-wrap break-all border-t pt-3 font-mono text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]",
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

export function Blocks({
  blocks,
  progress = {},
  capabilities = [],
}: {
  blocks: ContentBlock[];
  progress?: Record<string, string>;
  capabilities?: readonly AgentCapabilityId[];
}) {
  const results = new Map(
    blocks
      .filter(
        (block): block is Extract<ContentBlock, { type: "tool_result" }> =>
          block.type === "tool_result",
      )
      .map((block) => [block.tool_use_id, block]),
  );

  return (
    <div className="min-w-0 max-w-full space-y-3 overflow-hidden">
      {blocks.map((block, index) => {
        const generativePart = renderGenerativePart(block, capabilities);
        if (generativePart !== undefined) {
          return <Fragment key={index}>{generativePart}</Fragment>;
        }
        switch (block.type) {
          case "text":
            return (
              <div
                key={index}
                className="chat-markdown min-w-0 max-w-full overflow-hidden text-sm leading-6 [overflow-wrap:anywhere]"
              >
                <StreamingMarkdown>{block.text}</StreamingMarkdown>
              </div>
            );
          case "data-chart":
            return null;
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
                <p className="mt-2 max-w-full whitespace-pre-wrap break-all border-l pl-3 leading-5 text-muted-foreground/80 [overflow-wrap:anywhere]">
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
                progress={progress[block.id]}
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
            // Successful tool output is implementation detail. The tool row and
            // the agent's response provide the useful transcript; dumping an
            // orphaned payload here can expose entire skills or huge JSON blobs.
            if (!block.is_error) return null;
            return (
              <pre
                key={index}
                className={cn(
                  "max-h-56 max-w-full overflow-auto whitespace-pre-wrap break-all border bg-card/50 px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]",
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
