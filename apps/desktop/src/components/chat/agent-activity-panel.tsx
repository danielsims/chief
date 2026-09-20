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
  onClose,
  onOpenTask,
  sizing,
}: {
  error?: ChatRuntimeError;
  turns: readonly ConversationActivityTurn[];
  activeAgentId?: string;
  running: boolean;
  tasks: SessionRecord[];
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
  const selected = selectedId ? groups.get(selectedId) : undefined;
  return (
    <ConversationAuxiliaryPanel onClose={onClose} sizing={sizing}>
      <ConversationAuxiliaryPanelHeader
        title={selected?.name ?? "Activity"}
        onClose={onClose}
        onBack={selected ? () => setSelectedId(null) : undefined}
        backLabel="Back to agents"
      />
      <ConversationAuxiliaryPanelBody>
        {error ? (
          <div className="border-border border-b p-4">
            <p className="text-destructive flex items-center gap-2 text-sm">
              <CircleAlert size={14} />
              {error.title ?? "Error"}
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              {error.message}
            </p>
            {error.agentId ? (
              <Link
                to={`/agents?agent=${encodeURIComponent(error.agentId)}`}
                onClick={onClose}
                className="mt-2 inline-block text-sm underline"
              >
                Open agent settings
              </Link>
            ) : null}
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
            {selected.tasks
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((task) => (
                <button
                  key={task.id}
                  type="button"
                  disabled={!onOpenTask || task.provider === "relay"}
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
                  {onOpenTask && task.provider !== "relay" ? (
                    <ArrowRight size={14} />
                  ) : null}
                </button>
              ))}
            {[...selected.turns]
              .sort(
                (a, b) =>
                  (b.updatedAt ?? b.startedAt ?? 0) -
                  (a.updatedAt ?? a.startedAt ?? 0),
              )
              .map((turn, index) => (
                <section key={turn.id} className="border-border border-b">
                  <div className="text-muted-foreground flex items-center gap-3 px-4 py-3 text-xs">
                    <p className="min-w-0 flex-1 truncate">
                      {turn.prompt || "Agent activity"}
                    </p>
                    <time className="shrink-0">
                      {relativeActivityTime(turn.updatedAt ?? turn.startedAt)}
                    </time>
                  </div>
                  <ToolActivityGroup
                    flat
                    blocks={turn.blocks}
                    active={
                      selected.running &&
                      selected.id === activeAgentId &&
                      index === 0
                    }
                  />
                </section>
              ))}
            {!selected.tasks.length && !selected.turns.length ? (
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
  return [...tasks]
    .filter((task) => task.status === "failed" && task.error)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.error;
}
