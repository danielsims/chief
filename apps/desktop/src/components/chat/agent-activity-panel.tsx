import type { ContentBlock, SessionRecord } from "@chief/agent-runtime/types";

import type { ConversationActivityTurn } from "./conversation-activity-history";
import type { ConversationAuxiliaryPanelSizing } from "./conversation-auxiliary-panel";
import { AgentAvatar } from "../agent-avatar";
import {
  ConversationAuxiliaryPanel,
  ConversationAuxiliaryPanelBody,
  ConversationAuxiliaryPanelHeader,
} from "./conversation-auxiliary-panel";
import {
  specialistIsStartingOrWorking,
  SpecialistStatusIndicator,
} from "./specialist-status-indicator";
import { ToolActivityGroup } from "./tool-activity-group";

const ACTIVITY_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function taskAgentLabel(agent: string) {
  return agent === "brand"
    ? "Brand Researcher"
    : agent === "content"
      ? "Content Writer"
      : agent === "analyst"
        ? "Analyst"
        : agent === "prospector"
          ? "Prospector"
          : agent === "ads"
            ? "Ads Manager"
            : agent;
}

export function AgentActivityPanel({
  blocks,
  previousTurns,
  agentLabel,
  contextLabel,
  running,
  statusLabel,
  tasks,
  onClose,
  onOpenTask,
  sizing,
}: {
  blocks: ContentBlock[];
  previousTurns: readonly ConversationActivityTurn[];
  agentLabel: string;
  contextLabel: string;
  running: boolean;
  statusLabel: string;
  tasks: SessionRecord[];
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
  sizing: ConversationAuxiliaryPanelSizing;
}) {
  const hasTools = blocks.some((block) => block.type === "tool_use");
  const resultIds = new Set(
    blocks.flatMap((block) =>
      block.type === "tool_result" ? [block.tool_use_id] : [],
    ),
  );
  const hasIncompleteTools = blocks.some(
    (block) => block.type === "tool_use" && !resultIds.has(block.id),
  );

  return (
    <ConversationAuxiliaryPanel onClose={onClose} sizing={sizing}>
      <ConversationAuxiliaryPanelHeader
        title="Activity"
        subtitle={`${agentLabel} in ${contextLabel}`}
        onClose={onClose}
      />

      <ConversationAuxiliaryPanelBody className="p-4">
        <div className="bg-muted/35 flex items-center gap-3 rounded-xl px-3 py-3 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
          <AgentAvatar label={agentLabel} className="size-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{agentLabel}</p>
            <p
              className={
                running
                  ? "chief-shimmer-text mt-0.5 truncate text-[11px]"
                  : "text-muted-foreground mt-0.5 truncate text-[11px]"
              }
            >
              {running
                ? statusLabel
                : hasIncompleteTools
                  ? "Turn stopped"
                  : "Turn complete"}
            </p>
          </div>
          {running ? (
            <span className="relative flex size-2 shrink-0">
              <span className="bg-foreground/25 absolute inline-flex size-full animate-ping rounded-full" />
              <span className="bg-foreground/65 relative inline-flex size-2 rounded-full" />
            </span>
          ) : null}
        </div>

        <div className="mt-5">
          <p className="text-muted-foreground mb-2 px-1 text-[10px] font-medium">
            Current turn
          </p>
          {hasTools ? (
            <ToolActivityGroup blocks={blocks} active={running} />
          ) : (
            <p className="text-muted-foreground rounded-xl bg-black/[0.018] px-3 py-3 text-xs leading-5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)] dark:bg-white/[0.018]">
              {running
                ? `${agentLabel} is preparing a response. Detailed actions will appear here when tools or specialists are used.`
                : "No tools were needed for this turn."}
            </p>
          )}
        </div>

        {previousTurns.length > 0 ? (
          <div className="mt-5">
            <p className="text-muted-foreground mb-2 px-1 text-[10px] font-medium">
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
          <div className="mt-5">
            <p className="text-muted-foreground mb-2 px-1 text-[10px] font-medium">
              Specialists
            </p>
            <div className="space-y-1">
              {tasks.map((task) => {
                const active = specialistIsStartingOrWorking(task.status);
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpenTask?.(task.id)}
                    className="hover:bg-muted/45 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent)] transition-colors"
                  >
                    {active || task.status === "failed" ? (
                      <SpecialistStatusIndicator
                        agent={task.agent}
                        status={task.status}
                      />
                    ) : (
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500/80" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {task.title}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block truncate text-[10px]">
                        {taskAgentLabel(task.agent)} ·{" "}
                        {active
                          ? task.status === "idle"
                            ? "Starting"
                            : "Working"
                          : task.status}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </ConversationAuxiliaryPanelBody>
    </ConversationAuxiliaryPanel>
  );
}
