import type { ReactNode } from "react";
import { Fragment, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import type {
  AgentCapabilityId,
  ContentBlock,
  SessionRecord,
} from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import type { RelayPluginActionContext } from "../../lib/runtime-plugins";
import type { ChannelReferenceTarget } from "./channel-reference-parser";
import { renderGenerativePart } from "../generative-ui/registry";
import { executorToolLabel } from "./executor-tool-label";
import { PluginRecommendationCards, PluginToolCard } from "./plugin-tool-card";
import { isPluginTool } from "./plugin-tool-data";
import { SpecialistTaskCard } from "./specialist-task-card";
import { specialistTasksForInput } from "./specialist-task-display";
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
  if (
    clean === "execute" ||
    clean.endsWith("__execute") ||
    clean.endsWith(".execute") ||
    clean.includes("executor")
  ) {
    return "integration";
  }
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
  // Fall back to the executor operation label when the tool name is generic
  // but the input carries a recognizable connected-tool call.
  return executorToolLabel(input) ?? name.replace(/_/g, " ");
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
    return <SpecialistTaskCard task={task} onOpenTask={onOpenTask} />;
  }

  if (kind === "skill") {
    return (
      <div className="bg-card/50 flex min-h-14 w-96 max-w-full min-w-0 items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-[13px] leading-5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_72%,transparent)]">
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
            "text-muted-foreground shrink-0 text-[11px] leading-4",
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
    <details
      className="group bg-card/50 w-96 max-w-full min-w-0 overflow-hidden rounded-2xl border shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_72%,transparent)]"
      open
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-[13px] leading-5 [&::-webkit-details-marker]:hidden">
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
  channelReferences = [],
  onOpenChannel,
  onOpenTask,
  toolAttachment,
  pluginActionContext,
}: {
  blocks: ContentBlock[];
  progress?: Record<string, string>;
  capabilities?: readonly AgentCapabilityId[];
  active?: boolean;
  tasks?: readonly SessionRecord[];
  taskOwners?: ReadonlyMap<string, string>;
  ownerId?: string;
  channelReferences?: readonly ChannelReferenceTarget[];
  onOpenChannel?: (channelId: string) => void;
  onOpenTask?: (taskId: string) => void;
  pluginActionContext?: RelayPluginActionContext;
  /**
   * A generic hook for tools that carry a rich inline UI (Chief's embedded
   * browser, etc.). A tool block can render a live attachment at its exact
   * position in the message stream instead of a plain tool card — the same way
   * the channel feed embeds an attachment into the message body. Position is
   * inherent to the message, so the attachment never floats or re-anchors.
   */
  toolAttachment?: (
    block: Extract<ContentBlock, { type: "tool_use" }>,
    ownerId?: string,
    result?: Extract<ContentBlock, { type: "tool_result" }>,
  ) => ReactNode | undefined;
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
        if (block.type === "data-plugin-recommendations") {
          const data = block.data;
          const embeddedContext =
            data.workspaceId &&
            data.conversationId &&
            data.agentId &&
            data.recommendationId
              ? {
                  workspaceId: data.workspaceId,
                  conversationId: data.conversationId,
                  ...(data.threadRootId
                    ? { threadRootId: data.threadRootId }
                    : {}),
                  agentId: data.agentId,
                  recommendationId: data.recommendationId,
                }
              : undefined;
          return (
            <PluginRecommendationCards
              key={index}
              plugins={data.plugins}
              actionContext={embeddedContext ?? pluginActionContext}
              authorizations={data.authorizations}
            />
          );
        }
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
                <StreamingMarkdown
                  channels={channelReferences}
                  onOpenChannel={onOpenChannel}
                >
                  {block.text}
                </StreamingMarkdown>
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
                open
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
                <p className="text-muted-foreground mt-2 max-w-full text-[12px] leading-4 font-normal [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {block.thinking}
                </p>
              </details>
            );
          case "tool_use": {
            const attachment = toolAttachment?.(
              block,
              ownerId,
              results.get(block.id),
            );
            if (attachment !== undefined) {
              return <Fragment key={block.id}>{attachment}</Fragment>;
            }
            if (isPluginTool(block.name)) {
              return (
                <PluginToolCard
                  key={block.id}
                  block={block}
                  result={results.get(block.id)}
                  actionContext={pluginActionContext}
                />
              );
            }
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
