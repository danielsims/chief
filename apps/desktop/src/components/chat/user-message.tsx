import type { ReactNode } from "react";

import type { MessageAttachment } from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import { StreamingMarkdown } from "./streaming-markdown";

export function UserMessage({
  text,
  author = { name: "You" },
  attachments = [],
  onOpenProfile,
  onOpenMention,
  actions,
  footer,
  metadata,
}: {
  text: string;
  author?: { name: string; image?: string };
  attachments?: readonly MessageAttachment[];
  onOpenProfile?: () => void;
  onOpenMention?: (agentId: WorkspaceAgentId) => void;
  actions?: ReactNode;
  footer?: ReactNode;
  /** Secondary identity copy. Omit for the default "You" label; pass null
   * when the surrounding channel already makes authorship clear. */
  metadata?: ReactNode;
}) {
  const initials = author.name
    .split(/\s+/u)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase();
  const resolvedMetadata = metadata === undefined ? "You" : metadata;

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
          {resolvedMetadata ? (
            <span className="text-muted-foreground text-[10px]">
              {resolvedMetadata}
            </span>
          ) : null}
        </div>
        <div className="chat-markdown overflow-hidden text-sm leading-6 [overflow-wrap:anywhere]">
          <StreamingMarkdown onOpenMention={onOpenMention}>
            {text}
          </StreamingMarkdown>
        </div>
        {attachments.length > 0 ? (
          <div
            className="mt-2 grid max-w-lg grid-cols-2 gap-2"
            data-message-attachments
          >
            {attachments.map((attachment) => (
              <a
                key={`${attachment.name}:${attachment.url.slice(-24)}`}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${attachment.name}`}
                className="bg-muted/60 focus-visible:ring-ring/30 group/image relative min-h-28 overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_9%,transparent)] outline-none only:col-span-2 focus-visible:ring-2"
              >
                <img
                  src={attachment.url}
                  alt={attachment.name}
                  className="size-full max-h-72 object-cover transition-transform duration-200 group-hover/image:scale-[1.01]"
                />
              </a>
            ))}
          </div>
        ) : null}
        {footer}
      </div>
    </div>
  );
}
