/* eslint-disable max-lines */

import { Fragment, useEffect, useState } from "react";
import { ArrowRight, ChevronDown, ListChecks } from "lucide-react";

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
  brand: "border-sky-300/15 bg-sky-300/[0.055] text-sky-300",
  content: "border-amber-200/15 bg-amber-200/[0.055] text-amber-200",
  analyst: "border-emerald-300/15 bg-emerald-300/[0.055] text-emerald-300",
  prospector: "border-violet-300/15 bg-violet-300/[0.055] text-violet-300",
  ads: "border-rose-300/15 bg-rose-300/[0.055] text-rose-300",
};

function SpecialistActivity({ agentId }: { agentId: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-5 shrink-0 items-center justify-center border",
        AGENT_ACTIVITY_STYLES[agentId] ??
          "border-blue-300/15 bg-blue-300/[0.055] text-blue-300",
      )}
    >
      <i className="absolute size-2.5 animate-[spin_1.6s_linear_infinite] rounded-full border border-current/15 border-t-current/80 border-r-current/35 motion-reduce:animate-none" />
      <i className="size-0.5 rounded-full bg-current opacity-70" />
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
      className="group border border-white/[0.07] bg-white/[0.012]"
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
      <div className="space-y-2 border-t border-white/[0.06] px-3.5 py-3">
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
        className="hover:bg-foreground/[0.025] flex w-full items-center gap-3 border border-white/[0.07] bg-white/[0.012] px-3.5 py-3 text-left text-xs transition-colors"
      >
        {running ? (
          <SpecialistActivity agentId={task.agent} />
        ) : (
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center border border-white/10 bg-white/[0.025]",
              task.status === "completed" && "text-emerald-300",
              task.status === "failed" && "text-red-300",
            )}
          >
            <span className="size-1 rounded-full bg-current opacity-80" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <strong className="block truncate font-medium">{task.title}</strong>
          <small className="text-muted-foreground mt-0.5 block">
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
          className="text-muted-foreground/60 shrink-0"
          size={13}
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
