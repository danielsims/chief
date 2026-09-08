import { Hash } from "lucide-react";

import type { WorkspaceAgentId } from "../lib/workspace-channels";
import { useChiefNavigation } from "../lib/chief-navigation-context";
import { workspaceAgentIdentity } from "../lib/workspace-channels";
import { AgentAvatar } from "./agent-avatar";

export function OverviewActionContextLink({
  actionId,
  channel,
  channelLabel,
  directAgentId,
}: {
  actionId: string;
  channel?: { channelId: string; threadRootId: string } | null;
  channelLabel?: string;
  directAgentId?: WorkspaceAgentId | null;
}) {
  const chiefNavigation = useChiefNavigation();
  if (!channel && !directAgentId) return null;
  const label = channel
    ? (channelLabel ?? channel.channelId)
    : directAgentId
      ? workspaceAgentIdentity(directAgentId).name
      : "";

  return (
    <button
      type="button"
      onClick={() =>
        chiefNavigation.open(
          channel
            ? {
                kind: "conversation",
                channelId: channel.channelId,
                threadRootId: channel.threadRootId,
                messageId: actionId,
              }
            : {
                kind: "conversation",
                channelId: `direct:${directAgentId ?? ""}`,
                directAgentId,
                messageId: actionId,
              },
        )
      }
      className="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1.5 text-[11px] transition-colors"
    >
      {channel ? (
        <Hash size={11} strokeWidth={1.8} />
      ) : (
        <AgentAvatar
          label={label}
          className="size-4 rounded-sm"
          markClassName="size-2"
        />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
