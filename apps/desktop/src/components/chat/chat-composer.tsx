import { useRef, useState } from "react";
import { ArrowUp, AtSign, Square } from "lucide-react";

import type {
  ChatExecutionSelection,
  DriverType,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

import { PROVIDER_META } from "../../lib/providers";
import { useProviderModels } from "../../lib/runtime";

const CHAT_PROVIDERS: DriverType[] = ["claude", "codex", "opencode", "remote"];

const CHAT_SUGGESTIONS = [
  "What should we focus on this week?",
  "Review our current marketing plan",
  "Where are we losing momentum?",
];

export interface MentionCandidate {
  id: string;
  name: string;
  role: string;
  member: boolean;
}

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  execution,
  onExecutionChange,
  running = false,
  onInterrupt,
  showSuggestions = true,
  showExecutionControls = true,
  mentionCandidates = [],
  placeholder = "Message Chief…",
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  execution?: ChatExecutionSelection;
  onExecutionChange?: (execution: ChatExecutionSelection) => void;
  running?: boolean;
  onInterrupt?: () => void;
  showSuggestions?: boolean;
  showExecutionControls?: boolean;
  mentionCandidates?: MentionCandidate[];
  placeholder?: string;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const driver = execution?.driver;
  const model = execution?.model;
  const providerModels = useProviderModels(driver ?? null);
  const activeMeta = driver ? PROVIDER_META[driver] : null;
  const activeModel =
    providerModels.models.find((option) => option.value === model)?.label ??
    model ??
    "Auto";
  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(value);
  const mentionQuery = mentionMatch?.[1]?.toLocaleLowerCase();
  const visibleMentions =
    mentionQuery === undefined
      ? []
      : mentionCandidates
          .filter((candidate) =>
            `${candidate.name} ${candidate.role}`
              .toLocaleLowerCase()
              .includes(mentionQuery),
          )
          .sort((a, b) => Number(b.member) - Number(a.member))
          .slice(0, 6);
  const insertMention = (candidate: MentionCandidate) => {
    const start = mentionMatch ? value.length - mentionMatch[0].length : -1;
    if (start < 0) return;
    const leadingSpace = mentionMatch?.[0].startsWith(" ") ? " " : "";
    onValueChange(`${value.slice(0, start)}${leadingSpace}@${candidate.name} `);
    setMentionIndex(0);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className={cn("space-y-2", className)}>
      {showSuggestions ? (
        <div className="flex flex-wrap gap-2">
          {CHAT_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                onValueChange(suggestion);
                window.requestAnimationFrame(() =>
                  textareaRef.current?.focus(),
                );
              }}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg border px-2.5 py-1.5 text-xs transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      <div className="bg-card/80 relative rounded-xl border backdrop-blur-lg">
        {visibleMentions.length > 0 ? (
          <div className="bg-popover ring-foreground/10 absolute right-0 bottom-[calc(100%+8px)] left-0 z-30 overflow-hidden rounded-xl p-1.5 shadow-xl ring-1">
            <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium">
              <AtSign size={11} /> Mention an agent
            </div>
            {visibleMentions.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMention(candidate)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left",
                  index === mentionIndex && "bg-accent",
                )}
              >
                <span className="bg-foreground text-background flex size-7 shrink-0 items-center justify-center rounded-lg text-[9px] font-semibold dark:bg-white dark:text-black">
                  {candidate.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {candidate.name}
                  </span>
                  <span className="text-muted-foreground block truncate text-[10px]">
                    {candidate.role}
                  </span>
                </span>
                <span className="text-muted-foreground text-[10px]">
                  {candidate.member ? "In channel" : "Add to channel"}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (visibleMentions.length > 0) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex(
                  (current) =>
                    (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      visibleMentions.length) %
                    visibleMentions.length,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const candidate = visibleMentions[mentionIndex];
                if (candidate) insertMention(candidate);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onValueChange(value.replace(/@([^\s@]*)$/, "$1"));
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          rows={2}
          className="placeholder:text-muted-foreground w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 outline-none"
        />
        <div className="flex items-center justify-between px-3 pb-2">
          {showExecutionControls ? (
            <div className="flex items-center gap-3">
              <Select
                value={driver ?? undefined}
                disabled={running}
                onValueChange={(value) =>
                  onExecutionChange?.({ driver: value as DriverType })
                }
              >
                <SelectTrigger className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground h-6 w-auto gap-1.5 border-transparent px-1 text-xs">
                  {activeMeta ? (
                    <span className="flex items-center gap-1.5">
                      <activeMeta.Icon size={13} />
                      {activeMeta.label}
                    </span>
                  ) : (
                    <span>Choose agent app</span>
                  )}
                </SelectTrigger>
                <SelectContent className="min-w-32">
                  {CHAT_PROVIDERS.map((value) => {
                    const { label, Icon } = PROVIDER_META[value];
                    return (
                      <SelectItem key={value} value={value}>
                        <span className="flex items-center gap-1.5">
                          <Icon size={13} />
                          {label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {driver ? (
                <>
                  <span className="text-muted-foreground/50 text-xs">/</span>
                  <Select
                    value={model ?? "__auto__"}
                    disabled={running}
                    onValueChange={(value) =>
                      onExecutionChange?.({
                        driver,
                        model: value === "__auto__" ? undefined : value,
                      })
                    }
                  >
                    <SelectTrigger className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground h-6 w-auto max-w-48 gap-1.5 border-transparent px-1 text-xs">
                      <span className="truncate">
                        {providerModels.loading
                          ? "Loading models…"
                          : activeModel}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="max-h-72 min-w-56">
                      {(providerModels.models.length > 0
                        ? providerModels.models
                        : [{ value: "", label: "Auto" }]
                      ).map((option) => (
                        <SelectItem
                          key={option.value || "auto"}
                          value={option.value || "__auto__"}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : null}
            </div>
          ) : (
            <span />
          )}
          {running && onInterrupt ? (
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={onInterrupt}
            >
              <Square size={12} />
            </Button>
          ) : (
            <Button size="icon" className="h-7 w-7" onClick={onSubmit}>
              <ArrowUp size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
