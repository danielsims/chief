import { ArrowUpRight, CircleAlert } from "lucide-react";
import { Link } from "react-router";

import type { ContentBlock, SessionRecord } from "@chief/agent-runtime/types";

import type { ChatRuntimeError } from "../../lib/runtime-chat-controls";
import type { ConversationActivityTurn } from "./conversation-activity-history";
import type { ConversationAuxiliaryPanelSizing } from "./conversation-auxiliary-panel";
import {
  ConversationAuxiliaryPanel,
  ConversationAuxiliaryPanelBody,
  ConversationAuxiliaryPanelHeader,
} from "./conversation-auxiliary-panel";
import { relativeActivityTime } from "./relative-activity-time";
import { AgentActivityCard } from "./specialist-task-card";
import { ToolActivityGroup } from "./tool-activity-group";

const ACTIVITY_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function AgentActivityPanel({
  blocks,
  error,
  previousTurns,
  agentLabel,
  running,
  tasks,
  onClose,
  onOpenTask,
  sizing,
}: {
  blocks: ContentBlock[];
  error?: ChatRuntimeError;
  previousTurns: readonly ConversationActivityTurn[];
  agentLabel: string;
  running: boolean;
  tasks: SessionRecord[];
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
  sizing: ConversationAuxiliaryPanelSizing;
}) {
  const hasActivity = blocks.some(
    (block) => block.type === "thinking" || block.type === "tool_use",
  );
  return (
    <ConversationAuxiliaryPanel onClose={onClose} sizing={sizing}>
      <ConversationAuxiliaryPanelHeader title="Activity" onClose={onClose} />

      <ConversationAuxiliaryPanelBody className="p-4">
        {error ? (
          error.agentId ? (
            <Link
              to={`/agents?agent=${encodeURIComponent(error.agentId)}`}
              onClick={onClose}
              className="border-destructive/20 bg-destructive/5 hover:bg-destructive/10 mb-5 block rounded-lg border p-3 transition-colors"
            >
              <div className="text-destructive flex items-center gap-1.5 text-xs font-medium">
                <CircleAlert size={13} />
                {error.title ?? "Error"}
                <ArrowUpRight size={12} className="ml-auto" />
              </div>
              <p className="text-muted-foreground mt-2 text-xs leading-5">
                {error.message}
              </p>
            </Link>
          ) : (
            <section className="border-destructive/20 bg-destructive/5 mb-5 rounded-lg border p-3">
              <div className="text-destructive flex items-center gap-1.5 text-xs font-medium">
                <CircleAlert size={13} />
                {error.title ?? "Error"}
              </div>
              <p className="text-muted-foreground mt-2 text-xs leading-5">
                {error.message}
              </p>
            </section>
          )
        ) : null}
        {hasActivity ? (
          <div>
            <p className="text-muted-foreground mb-2 px-1 text-[12px] leading-4 font-normal">
              {agentLabel} activity
            </p>
            <ToolActivityGroup blocks={blocks} active={running} />
          </div>
        ) : null}

        {previousTurns.length > 0 ? (
          <div className="mt-5">
            <p className="text-muted-foreground mb-2 px-1 text-[12px] leading-4 font-normal">
              Earlier activity
            </p>
            <div className="space-y-3">
              {previousTurns.map((turn) => (
                <div
                  key={turn.id}
                  className="space-y-1.5 [content-visibility:auto]"
                >
                  <div className="flex min-w-0 items-center gap-2 px-1">
                    <p className="text-muted-foreground min-w-0 flex-1 truncate text-[10px]">
                      {turn.prompt || "Previous turn"}
                    </p>
                    {turn.startedAt ? (
                      <time className="text-muted-foreground/70 shrink-0 text-[9px]">
                        {ACTIVITY_TIME_FORMATTER.format(turn.startedAt)}
                      </time>
                    ) : null}
                  </div>
                  <ToolActivityGroup blocks={turn.blocks} active={false} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {tasks.length > 0 ? (
          <div
            className={hasActivity || previousTurns.length > 0 ? "mt-5" : ""}
          >
            <p className="text-muted-foreground mb-2 px-1 text-[12px] leading-4 font-normal">
              Agents
            </p>
            <div className="space-y-1">
              {tasks.map((task) => (
                <AgentActivityCard
                  key={task.id}
                  task={task}
                  className="w-full"
                  detail={`Last activity ${relativeActivityTime(task.updatedAt)}`}
                  onOpenTask={onOpenTask}
                />
              ))}
            </div>
          </div>
        ) : null}
      </ConversationAuxiliaryPanelBody>
    </ConversationAuxiliaryPanel>
  );
}
