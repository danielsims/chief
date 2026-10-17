import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import { Link } from "react-router";

import type { SessionRecord } from "@chief/agent-runtime/types";

import type { ChatRuntimeError } from "../../lib/runtime-chat-controls";
import type { ConversationActivityTurn } from "./conversation-activity-history";
import type { ConversationAuxiliaryPanelSizing } from "./conversation-auxiliary-panel";
import { useRuntime } from "../../lib/runtime";
import { AgentAvatar } from "../agent-avatar";
import {
  ConversationAuxiliaryPanel,
  ConversationAuxiliaryPanelBody,
  ConversationAuxiliaryPanelHeader,
} from "./conversation-auxiliary-panel";
import { relativeActivityTime } from "./relative-activity-time";
import { taskAgentLabel } from "./specialist-task-card";
import { ToolActivityGroup } from "./tool-activity-group";

interface AgentActivity {
  id: string;
  name: string;
  updatedAt: number;
  running: boolean;
  turns: ConversationActivityTurn[];
  tasks: SessionRecord[];
}

export function AgentActivityPanel({
  error,
  turns,
  activeAgentId,
  running,
  tasks,
  flat = false,
  title,
  onBack,
  backLabel,
  onClose,
  onOpenTask,
  sizing,
}: {
  error?: ChatRuntimeError;
  turns: readonly ConversationActivityTurn[];
  activeAgentId?: string;
  running: boolean;
  tasks: SessionRecord[];
  /** A single-agent surface (a DM) shows its activity directly, with no
   * intermediate list of agents. */
  flat?: boolean;
  /** Overrides the header title, e.g. the agent a DM is with. */
  title?: string;
  /** Where the header's back control returns to, e.g. the thread. */
  onBack?: () => void;
  backLabel?: string;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
  sizing: ConversationAuxiliaryPanelSizing;
}) {
  const { agents } = useRuntime();
  const roster = agents.flatMap((agent) => [agent, ...(agent.subagents ?? [])]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const groups = new Map<string, AgentActivity>();
  const groupFor = (id: string) => {
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name:
          roster.find((agent) => agent.id === id)?.name ??
          (id === "unknown" ? "Unassigned activity" : taskAgentLabel(id)),
        updatedAt: 0,
        running: false,
        turns: [],
        tasks: [],
      };
      groups.set(id, group);
    }
    return group;
  };
  for (const turn of turns) {
    const group = groupFor(turn.agentId ?? "unknown");
    group.turns.push(turn);
    group.updatedAt = Math.max(
      group.updatedAt,
      turn.updatedAt ?? turn.startedAt ?? 0,
    );
  }
  for (const task of tasks) {
    const group = groupFor(task.agent);
    group.tasks.push(task);
    group.updatedAt = Math.max(group.updatedAt, task.updatedAt);
    group.running ||= task.status === "running" || task.status === "idle";
  }
  if (running && activeAgentId) groupFor(activeAgentId).running = true;
  const ordered = [...groups.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name),
  );
  // A DM is one agent's surface: its work is shown as a single list, even
  // when its runs report under more than one identity.
  const selected = flat
    ? ordered.length > 0
      ? {
          id: activeAgentId ?? ordered[0]?.id ?? "agent",
          name: title ?? ordered[0]?.name ?? "Activity",
          updatedAt: Math.max(...ordered.map((group) => group.updatedAt)),
          running: ordered.some((group) => group.running),
          turns: ordered.flatMap((group) => group.turns),
          tasks: ordered.flatMap((group) => group.tasks),
        }
      : undefined
    : selectedId
      ? groups.get(selectedId)
      : undefined;
  const headerBack = !flat && selected ? () => setSelectedId(null) : onBack;
  // A run's failure is shown on the turn it stopped, not repeated up top.
  const failureShownOnTurn = Boolean(
    selected?.turns.some(
      (turn) => relayJobForTurn(turn, selected.tasks)?.status === "failed",
    ),
  );
  return (
    <ConversationAuxiliaryPanel onClose={onClose} sizing={sizing}>
      <ConversationAuxiliaryPanelHeader
        title={selected?.name ?? title ?? "Activity"}
        subtitle={flat ? "Activity" : undefined}
        onClose={onClose}
        onBack={headerBack}
        backLabel={!flat && selected ? "Back to agents" : backLabel}
      />
      <ConversationAuxiliaryPanelBody>
        {error && !failureShownOnTurn ? (
          <div className="border-border border-b px-4 py-3">
            <ActivityNotice
              title={error.title ?? "Something went wrong"}
              message={error.message}
              action={
                error.agentId ? (
                  <Link
                    to={`/agents?agent=${encodeURIComponent(error.agentId)}`}
                    onClick={onClose}
                    className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
                    Agent settings
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : null}
        {!selected ? (
          <div className="divide-border divide-y">
            {ordered.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => setSelectedId(agent.id)}
                className="hover:bg-muted/40 flex min-h-18 w-full items-center gap-3 px-4 py-4 text-left transition-colors"
              >
                <AgentAvatar agentId={agent.id} label={agent.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {agent.name}
                  </span>
                  <span className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                    {agent.running ? (
                      <>
                        <LoaderCircle size={12} className="animate-spin" />
                        Working
                      </>
                    ) : latestTaskError(agent.tasks) ? (
                      <span className="text-destructive line-clamp-2">
                        {latestTaskError(agent.tasks)}
                      </span>
                    ) : (
                      relativeActivityTime(agent.updatedAt)
                    )}
                  </span>
                </span>
                <ArrowRight size={14} className="text-muted-foreground" />
              </button>
            ))}
            {!ordered.length ? (
              <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                Agent activity will appear here.
              </p>
            ) : null}
          </div>
        ) : (
          <div>
            {localTasks(selected.tasks)
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((task) => (
                <button
                  key={task.id}
                  type="button"
                  disabled={!onOpenTask}
                  onClick={() => onOpenTask?.(task.id)}
                  className="border-border hover:bg-muted/40 flex w-full items-center gap-3 border-b px-4 py-4 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{task.title}</span>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {task.status.replaceAll("_", " ")} ·{" "}
                      {relativeActivityTime(task.updatedAt)}
                    </span>
                    {task.error ? (
                      <span className="text-destructive mt-2 block text-sm">
                        {task.error}
                      </span>
                    ) : null}
                  </span>
                  {onOpenTask ? <ArrowRight size={14} /> : null}
                </button>
              ))}
            {[...selected.turns]
              .sort(
                (a, b) =>
                  (b.updatedAt ?? b.startedAt ?? 0) -
                  (a.updatedAt ?? a.startedAt ?? 0),
              )
              .map((turn, index) => {
                const job = relayJobForTurn(turn, selected.tasks);
                const working = job
                  ? job.status === "running" || job.status === "waiting"
                  : selected.running && index === 0;
                return (
                  <section key={turn.id} className="border-border border-b">
                    <div className="flex items-start gap-3 px-4 pt-3 pb-2">
                      <p className="min-w-0 flex-1 text-sm leading-5">
                        {turn.prompt || "Agent activity"}
                      </p>
                      <time className="text-muted-foreground shrink-0 pt-0.5 text-xs">
                        {relativeActivityTime(turn.updatedAt ?? turn.startedAt)}
                      </time>
                    </div>
                    {turn.blocks.length > 0 ? (
                      <ToolActivityGroup
                        flat
                        blocks={turn.blocks}
                        toolTimes={turn.toolTimes}
                        active={working}
                      />
                    ) : null}
                    {job?.status === "failed" ? (
                      <div className="px-4 pb-3">
                        <ActivityNotice
                          title="Run stopped"
                          message={
                            job.error ?? "The run ended before it finished."
                          }
                        />
                      </div>
                    ) : working ? (
                      <p className="text-muted-foreground flex items-center gap-2 px-4 pb-3 text-xs">
                        <LoaderCircle size={12} className="animate-spin" />
                        Working…
                      </p>
                    ) : turn.blocks.length === 0 ? (
                      <p className="text-muted-foreground px-4 pb-3 text-xs">
                        Answered without using tools.
                      </p>
                    ) : null}
                  </section>
                );
              })}
            {!localTasks(selected.tasks).length && !selected.turns.length ? (
              <p className="text-muted-foreground p-4 text-sm">
                Waiting for activity…
              </p>
            ) : null}
          </div>
        )}
      </ConversationAuxiliaryPanelBody>
    </ConversationAuxiliaryPanel>
  );
}

function latestTaskError(tasks: readonly SessionRecord[]) {
  // Only the most recent run's error is current. An older failed run must not
  // keep showing once newer work has happened.
  const latest = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return latest?.status === "failed" ? latest.error : undefined;
}

// A relay job is the run behind a turn, not separate work: its tool calls and
// thinking arrive as conversation activity. Only local tasks have their own
// transcript to open.
function localTasks(tasks: readonly SessionRecord[]) {
  return tasks.filter((task) => task.provider !== "relay");
}

/** The relay job that ran a turn: same thread, started closest to it. */
function relayJobForTurn(
  turn: ConversationActivityTurn,
  tasks: readonly SessionRecord[],
) {
  if (!turn.threadRootId) return undefined;
  const startedAt = turn.startedAt ?? 0;
  return tasks
    .filter(
      (task) =>
        task.provider === "relay" && task.triggerId === turn.threadRootId,
    )
    .sort(
      (a, b) =>
        Math.abs(a.createdAt - startedAt) - Math.abs(b.createdAt - startedAt),
    )[0];
}

/** A quiet, contained notice for a stopped run or a runtime error. */
function ActivityNotice({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-black/[0.025] px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)] dark:bg-white/[0.03]">
      <CircleAlert
        size={13}
        className="text-destructive/80 mt-[3px] shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-foreground/90 text-xs font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
          {message}
        </p>
      </div>
      {action ? <div className="shrink-0 pt-px">{action}</div> : null}
    </div>
  );
}
