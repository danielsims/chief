import { Fragment } from "react";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { ChannelReferenceTarget } from "./channel-reference-parser";
import { AgentMentionText } from "./agent-mention";
import { splitChannelReferences } from "./channel-reference-parser";

export function ChannelReferenceText({
  text,
  channels,
  onOpenChannel,
  onOpenMention,
}: {
  text: string;
  channels: readonly ChannelReferenceTarget[];
  onOpenChannel?: (channelId: string) => void;
  onOpenMention?: (agentId: WorkspaceAgentId) => void;
}) {
  return splitChannelReferences(text, channels).map((segment, index) =>
    segment.type === "channel" ? (
      <button
        key={`${index}:${segment.channelId}`}
        type="button"
        className="focus-visible:ring-ring/30 inline font-medium text-sky-500 hover:text-sky-400 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        data-channel-reference={segment.channelId}
        onClick={() => onOpenChannel?.(segment.channelId)}
      >
        {segment.label}
      </button>
    ) : (
      <Fragment key={`${index}:${segment.value}`}>
        <AgentMentionText text={segment.value} onOpenMention={onOpenMention} />
      </Fragment>
    ),
  );
}
