import { useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

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

import type { EmojiOption } from "./emoji-catalog";
import { PROVIDER_META } from "../../lib/providers";
import { useProviderModels } from "../../lib/runtime";
import { AgentAvatar } from "../agent-avatar";
import { splitAgentMentions } from "./agent-mention-parser";
import { EmojiAutocomplete } from "./emoji-autocomplete";
import { emojiForShortcode, matchingEmoji } from "./emoji-catalog";

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
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [emojiIndex, setEmojiIndex] = useState(0);
  const [composerScroll, setComposerScroll] = useState({ left: 0, top: 0 });
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
    mentionQuery === undefined || mentionDismissed
      ? []
      : mentionCandidates
          .filter((candidate) =>
            `${candidate.name} ${candidate.role}`
              .toLocaleLowerCase()
              .includes(mentionQuery),
          )
          .sort((a, b) => Number(b.member) - Number(a.member))
          .slice(0, 6);
  const emojiMatch = /(?:^|\s):([a-z0-9_+-]*)$/iu.exec(value);
  const emojiQuery = emojiMatch?.[1];
  const visibleEmojis =
    mentionQuery === undefined && emojiQuery !== undefined
      ? matchingEmoji(emojiQuery)
      : [];
  const composerSegments = useMemo(() => splitAgentMentions(value), [value]);
  const hasComposerMentions = composerSegments.some(
    (segment) => segment.type === "mention",
  );
  const insertMention = (candidate: MentionCandidate) => {
    const start = mentionMatch ? value.length - mentionMatch[0].length : -1;
    if (start < 0) return;
    const leadingSpace = mentionMatch?.[0].startsWith(" ") ? " " : "";
    onValueChange(`${value.slice(0, start)}${leadingSpace}@${candidate.name} `);
    setMentionIndex(0);
    setMentionDismissed(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const insertEmoji = (option: EmojiOption) => {
    const start = emojiMatch ? value.length - emojiMatch[0].length : -1;
    if (start < 0) return;
    const leadingSpace = emojiMatch?.[0].startsWith(" ") ? " " : "";
    onValueChange(`${value.slice(0, start)}${leadingSpace}${option.emoji} `);
    setEmojiIndex(0);
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
                <AgentAvatar label={candidate.name} className="size-7" />
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
        <EmojiAutocomplete
          suggestions={visibleEmojis}
          selectedIndex={emojiIndex}
          onSelect={insertEmoji}
        />
        <div className="relative">
          {hasComposerMentions ? (
            <div
              aria-hidden
              data-composer-mention-overlay
              className="text-foreground pointer-events-none absolute inset-0 overflow-hidden px-3 pt-3 text-[13px] leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap"
            >
              <span
                className="block min-h-full"
                style={{
                  transform: `translate(${-composerScroll.left}px, ${-composerScroll.top}px)`,
                }}
              >
                {composerSegments.map((segment, index) =>
                  segment.type === "mention" ? (
                    <span
                      key={`${index}:${segment.agentId}`}
                      data-composer-agent-mention={segment.agentId}
                      className="before:bg-foreground/[0.075] relative isolate rounded-[4px] [box-decoration-break:clone] [-webkit-box-decoration-break:clone] before:absolute before:-inset-x-1.5 before:inset-y-px before:-z-10 before:rounded-[5px] before:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_13%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_32%,transparent)] before:content-['']"
                    >
                      @{segment.label}
                    </span>
                  ) : (
                    <span key={`${index}:${segment.value}`}>
                      {segment.value}
                    </span>
                  ),
                )}
              </span>
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={value}
            onScroll={(event) =>
              setComposerScroll({
                left: event.currentTarget.scrollLeft,
                top: event.currentTarget.scrollTop,
              })
            }
            onChange={(event) => {
              const nextValue = event.target.value;
              const completedEmoji = /(?:^|\s):([a-z0-9_+-]+):$/iu.exec(
                nextValue,
              );
              const option = completedEmoji?.[1]
                ? emojiForShortcode(completedEmoji[1])
                : undefined;
              if (completedEmoji && option) {
                const start = nextValue.length - completedEmoji[0].length;
                const leadingSpace = completedEmoji[0].startsWith(" ")
                  ? " "
                  : "";
                onValueChange(
                  `${nextValue.slice(0, start)}${leadingSpace}${option.emoji} `,
                );
              } else {
                onValueChange(nextValue);
              }
              setMentionIndex(0);
              setMentionDismissed(false);
              setEmojiIndex(0);
            }}
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
                  const candidate =
                    visibleMentions[mentionIndex % visibleMentions.length];
                  if (candidate) insertMention(candidate);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setMentionDismissed(true);
                  return;
                }
              }
              if (visibleEmojis.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setEmojiIndex(
                    (current) =>
                      (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        visibleEmojis.length) %
                      visibleEmojis.length,
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  const option =
                    visibleEmojis[emojiIndex % visibleEmojis.length];
                  if (option) insertEmoji(option);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  const start = emojiMatch
                    ? value.length - emojiMatch[0].length
                    : value.length;
                  const leadingSpace = emojiMatch?.[0].startsWith(" ")
                    ? " "
                    : "";
                  onValueChange(
                    `${value.slice(0, start)}${leadingSpace}${emojiQuery ?? ""}`,
                  );
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
            className={cn(
              "placeholder:text-muted-foreground relative z-10 w-full resize-none bg-transparent px-3 pt-3 text-[13px] leading-6 [overflow-wrap:anywhere] outline-none",
              hasComposerMentions &&
                "caret-foreground selection:bg-foreground/15 text-transparent",
            )}
          />
        </div>
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
