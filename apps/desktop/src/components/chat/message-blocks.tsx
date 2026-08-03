import { Fragment, useEffect, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";

import type {
  AgentCapabilityId,
  ContentBlock,
  SessionRecord,
} from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { renderGenerativePart } from "../generative-ui/registry";
import { executorToolLabel } from "./executor-tool-label";
import { specialistTasksForInput } from "./specialist-task-display";
import { StreamingMarkdown } from "./streaming-markdown";

const MAX_RESULT_CHARS = 3000;
const AGENT_ACTIVITY_STYLES: Record<string, string> = {
  brand: "text-sky-500 dark:text-sky-300",
  content: "text-amber-500 dark:text-amber-300",
  analyst: "text-emerald-500 dark:text-emerald-300",
  prospector: "text-violet-500 dark:text-violet-300",
  ads: "text-rose-500 dark:text-rose-300",
};
const SPECIALIST_SIGNAL_PIXELS = [
  "top-0 left-1/2 -translate-x-1/2 opacity-100",
  "top-px right-px opacity-80",
  "top-1/2 right-0 -translate-y-1/2 opacity-65",
  "right-px bottom-px opacity-50",
  "bottom-0 left-1/2 -translate-x-1/2 opacity-35",
  "bottom-px left-px opacity-25",
  "top-1/2 left-0 -translate-y-1/2 opacity-15",
  "top-px left-px opacity-10",
] as const;

function SpecialistActivity({ agentId }: { agentId: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-background/80 relative flex size-8 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_70%,transparent)]",
        AGENT_ACTIVITY_STYLES[agentId] ?? "text-blue-500 dark:text-blue-300",
      )}
    >
      <span className="relative size-4 animate-[spin_1.15s_steps(8,end)_infinite] motion-reduce:animate-none">
        {SPECIALIST_SIGNAL_PIXELS.map((className) => (
          <i
            key={className}
            className={cn(
              "absolute size-[3px] rounded-[1px] bg-current",
              className,
            )}
          />
        ))}
      </span>
      <i className="absolute size-0.5 rounded-[1px] bg-current opacity-20" />
    </span>
  );
}

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

export function toolPresentation(name: string, input: unknown) {
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
    "file",
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
  active,
  task,
  onOpenTask,
}: {
  block: Extract<ContentBlock, { type: "tool_use" }>;
  result?: Extract<ContentBlock, { type: "tool_result" }>;
  progress?: string;
  active: boolean;
  task?: SessionRecord;
  onOpenTask?: (taskId: string) => void;
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
    if (result || !active) return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [active, result]);

  if (task) {
    const running = task.status === "running" || task.status === "waiting";
    const agent =
      task.agent === "brand"
        ? "Brand Researcher"
        : task.agent === "content"
          ? "Content Writer"
          : task.agent === "analyst"
            ? "Analyst"
            : task.agent === "prospector"
              ? "Prospector"
              : task.agent === "ads"
                ? "Ads Manager"
                : task.agent;
    return (
      <button
        type="button"
        onClick={() => onOpenTask?.(task.id)}
        className="bg-muted/45 hover:bg-muted/60 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_65%,transparent)] transition-colors"
      >
        {running ? (
          <SpecialistActivity agentId={task.agent} />
        ) : (
          <span
            className={cn(
              "bg-background flex size-8 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]",
              task.status === "completed" && "text-emerald-500",
              task.status === "failed" && "text-red-500",
            )}
          >
            <span className="size-1.5 rounded-full bg-current opacity-80" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <strong className="block truncate font-medium">{task.title}</strong>
          <small className="text-muted-foreground mt-0.5 block text-[11px]">
            {agent} ·{" "}
            {running
              ? "Working"
              : task.status === "completed"
                ? "Complete"
                : task.status === "failed"
                  ? "Failed"
                  : "Stopped"}
          </small>
        </span>
        <ArrowRight
          aria-hidden
          className="text-muted-foreground/55 shrink-0"
          size={12}
        />
      </button>
    );
  }

  if (kind === "skill") {
    return (
      <div className="bg-card/50 flex max-w-full min-w-0 items-center gap-2.5 border px-3 py-2 text-xs">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            !result && active && "animate-pulse bg-blue-500",
            !result && !active && "bg-muted-foreground/50",
            result?.is_error ? "bg-red-500" : result && "bg-emerald-500",
          )}
        />
        <span className="shrink-0 font-medium">Skill</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          {label}
        </span>
        <span
          className={cn(
            "text-muted-foreground shrink-0 text-[10px]",
            result?.is_error && "text-red-500",
          )}
        >
          {result
            ? result.is_error
              ? "Failed"
              : "Done"
            : active
              ? "Loading"
              : "Stopped"}
        </span>
      </div>
    );
  }

  return (
    <details className="group bg-card/50 max-w-full min-w-0 overflow-hidden border">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            !result && active && "animate-pulse bg-blue-500",
            !result && !active && "bg-muted-foreground/50",
            result?.is_error && "bg-red-500",
            result && !result.is_error && warning && "bg-amber-400",
            result && !result.is_error && !warning && "bg-emerald-500",
          )}
        />
        <span className="shrink-0 font-medium">{label}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
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
        ) : active ? (
          <span className="text-muted-foreground text-[10px]">
            {elapsed >= 30 ? "Still working" : "Running"} · {elapsed}s
          </span>
        ) : (
          <span className="text-muted-foreground text-[10px]">Stopped</span>
        )}
        <ChevronDown
          size={12}
          className="text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        {input && input !== "{}" ? (
          <pre className="text-muted-foreground max-h-40 max-w-full overflow-auto font-mono text-[11px] leading-5 [overflow-wrap:anywhere] break-all whitespace-pre-wrap">
            {input}
          </pre>
        ) : null}
        {shownOutput ? (
          <pre
            className={cn(
              "text-muted-foreground max-h-56 max-w-full overflow-auto border-t pt-3 font-mono text-[11px] leading-5 [overflow-wrap:anywhere] break-all whitespace-pre-wrap",
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
  active = true,
  tasks = [],
  taskOwners,
  ownerId,
  onOpenTask,
}: {
  blocks: ContentBlock[];
  progress?: Record<string, string>;
  capabilities?: readonly AgentCapabilityId[];
  active?: boolean;
  tasks?: readonly SessionRecord[];
  taskOwners?: ReadonlyMap<string, string>;
  ownerId?: string;
  onOpenTask?: (taskId: string) => void;
}) {
  const results = new Map(
    blocks
      .filter(
        (block): block is Extract<ContentBlock, { type: "tool_result" }> =>
          block.type === "tool_result",
      )
      .map((block) => [block.tool_use_id, block]),
  );
  const renderedTasks = new Set<string>();

  return (
    <div className="max-w-full min-w-0 space-y-3 overflow-hidden">
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
                className="chat-markdown max-w-full min-w-0 overflow-hidden text-sm leading-6 [overflow-wrap:anywhere]"
              >
                <StreamingMarkdown>{block.text}</StreamingMarkdown>
              </div>
            );
          case "data-chart":
          case "data-table":
            return null;
          case "thinking":
            return (
              <details
                key={index}
                className="group text-muted-foreground text-xs"
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
                <p className="text-muted-foreground/80 mt-2 max-w-full border-l pl-3 leading-5 [overflow-wrap:anywhere] break-all whitespace-pre-wrap">
                  {block.thinking}
                </p>
              </details>
            );
          case "tool_use": {
            const blockTasks = specialistTasksForInput(block.input, tasks);
            const visibleTasks = blockTasks.filter(
              (task) =>
                taskOwners?.get(task.id) === ownerId &&
                !renderedTasks.has(task.id),
            );
            for (const task of visibleTasks) renderedTasks.add(task.id);
            if (blockTasks.length > 0) {
              return visibleTasks.map((task) => (
                <ToolCard
                  key={`${block.id}-${task.id}`}
                  block={block}
                  result={results.get(block.id)}
                  progress={progress[block.id]}
                  active={active}
                  task={task}
                  onOpenTask={onOpenTask}
                />
              ));
            }
            return (
              <ToolCard
                key={block.id}
                block={block}
                result={results.get(block.id)}
                progress={progress[block.id]}
                active={active}
                onOpenTask={onOpenTask}
              />
            );
          }
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
                  "bg-card/50 text-muted-foreground max-h-56 max-w-full overflow-auto border px-3 py-2 font-mono text-[11px] leading-5 [overflow-wrap:anywhere] break-all whitespace-pre-wrap",
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
