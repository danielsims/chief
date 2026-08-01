import type { ReactNode } from "react";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import { StreamingMarkdown } from "./streaming-markdown";

export function UserMessage({
  text,
  author = { name: "You" },
  onOpenProfile,
  onOpenMention,
  actions,
  footer,
}: {
  text: string;
  author?: { name: string; image?: string };
  onOpenProfile?: () => void;
  onOpenMention?: (agentId: WorkspaceAgentId) => void;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const initials = author.name
    .split(/\s+/u)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase();

  return (
    <div className="group/message relative mx-auto flex w-full max-w-3xl min-w-0 gap-3 py-2">
      {actions}
      <button
        type="button"
        aria-label={`Open ${author.name} profile`}
        title={`Open ${author.name} profile`}
        disabled={!onOpenProfile}
        onClick={onOpenProfile}
        className="bg-muted text-muted-foreground focus-visible:ring-ring/30 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] transition-opacity outline-none enabled:hover:opacity-85 enabled:focus-visible:ring-2 disabled:cursor-default"
      >
        {author.image ? (
          <img src={author.image} alt="" className="size-full object-cover" />
        ) : (
          initials || "Y"
        )}
      </button>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 flex items-baseline gap-2">
          <strong className="text-[13px] font-semibold">{author.name}</strong>
          <span className="text-muted-foreground text-[10px]">You</span>
        </div>
        <div className="chat-markdown overflow-hidden text-sm leading-6 [overflow-wrap:anywhere]">
          <StreamingMarkdown onOpenMention={onOpenMention}>
            {text}
          </StreamingMarkdown>
        </div>
        {footer}
      </div>
    </div>
  );
}
