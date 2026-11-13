import { Fragment } from "react";

import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import { AgentAvatar } from "../agent-avatar";
import { ChiefMark } from "../chief-mark";
import { splitAgentMentions } from "./agent-mention-parser";
import { useMentionAliases, useMentionPeople } from "./mention-people-context";

export function AgentMentionText({
  text,
  onOpenMention,
}: {
  text: string;
  onOpenMention?: (agentId: WorkspaceAgentId) => void;
}) {
  const people = useMentionAliases();
  const persons = useMentionPeople();
  return splitAgentMentions(text, people).map((segment, index) => {
    if (segment.type === "text") {
      return (
        <Fragment key={`${index}:${segment.value}`}>{segment.value}</Fragment>
      );
    }

    const isAgent = !persons.some((person) => person.id === segment.agentId);
    const content = (
      <>
        {isAgent ? (
          <AgentAvatar
            agentId={segment.agentId}
            label={segment.label}
            className="size-3.5 rounded-[4px]"
            markClassName="size-2.5"
          />
        ) : (
          <ChiefMark className="size-3" title={segment.label} />
        )}
        <span className="relative -top-[0.06em] whitespace-nowrap">
          {segment.label}
        </span>
      </>
    );
    const className = cn(
      "bg-foreground/[0.065] text-foreground mx-0.5 inline-flex min-h-[1.35em] items-center gap-1 rounded-md px-1.5 align-baseline text-[0.95em] leading-none font-medium shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_11%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_28%,transparent)] transition-colors",
      onOpenMention && isAgent && "hover:bg-foreground/[0.11] cursor-pointer",
    );

    return onOpenMention && isAgent ? (
      <button
        key={`${index}:${segment.agentId}`}
        type="button"
        data-agent-mention={segment.agentId}
        className={className}
        onClick={() => onOpenMention(segment.agentId)}
      >
        {content}
      </button>
    ) : (
      <span
        key={`${index}:${segment.agentId}`}
        data-agent-mention={segment.agentId}
        className={className}
      >
        {content}
      </span>
    );
  });
}
