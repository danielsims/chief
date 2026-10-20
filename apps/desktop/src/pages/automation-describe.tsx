import { useState } from "react";
import { ArrowUp } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { AutomationDraft } from "./automation-draft";
import { AgentActivityComposerRow } from "../components/chat/agent-activity-composer-row";
import { cronFromFields } from "./schedule-editor";

/**
 * The composer's message: the request plus which automation it is about.
 * Chief handles it exactly as it would the same request in a channel.
 */
export function draftingMessage(
  description: string,
  draft: AutomationDraft,
  saved: boolean,
) {
  const request = `"${description.replaceAll('"', "'")}"`;
  if (saved) return `@chief, about automation "${draft.id}": ${request}`;
  return [
    `@chief, build automation "${draft.id}": ${request}`,
    `It isn't saved yet. Use agentId "${draft.agentId}", collaborators ${JSON.stringify(draft.collaborators)}, timezone "${draft.timezone}", ${draft.channelId === "new" ? "newChannel {}" : `conversationId "${draft.channelId}"`}, and unless the request implies another trigger, cron "${cronFromFields(draft.fields)}".`,
    draft.steps.length
      ? `Keep these steps unless asked otherwise: ${JSON.stringify({ version: 1, steps: draft.steps })}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Floats over the canvas: say what should happen and Chief builds or changes the steps. */
export function AutomationComposer({
  busy,
  note,
  disabled,
  onSubmit,
  onOpenThread,
}: {
  busy: boolean;
  note: string | null;
  disabled: boolean;
  onSubmit: (description: string) => void;
  /** Opens the channel thread where Chief is doing the work. */
  onOpenThread?: () => void;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSubmit(text);
    setValue("");
  };
  return (
    <div className="w-[520px] max-w-[calc(100%-32px)]">
      {busy ? (
        <AgentActivityComposerRow
          running
          statusLabel="Chief is working"
          onOpen={() => onOpenThread?.()}
        />
      ) : note ? (
        <button
          type="button"
          disabled={!onOpenThread}
          onClick={onOpenThread}
          className="text-muted-foreground enabled:hover:text-foreground mb-2 line-clamp-3 w-full px-1 text-center text-[12px]"
        >
          {note}
        </button>
      ) : null}
      <div
        className={cn(
          "bg-card/80 flex items-end gap-2 rounded-xl border p-2 pl-3 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] backdrop-blur-lg",
          busy && "opacity-80",
        )}
      >
        <textarea
          rows={1}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Describe what this automation should do"
          className="placeholder:text-muted-foreground/70 field-sizing-content max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 text-[13px] leading-5 outline-none"
        />
        <Button
          size="icon-xs"
          aria-label="Build the steps"
          disabled={!value.trim() || busy || disabled}
          onClick={submit}
        >
          <ArrowUp size={14} />
        </Button>
      </div>
    </div>
  );
}
