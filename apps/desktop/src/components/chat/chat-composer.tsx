import { useRef } from "react";
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

import { PROVIDER_META } from "../../lib/providers";
import { useProviderModels } from "../../lib/runtime";

const CHAT_PROVIDERS: DriverType[] = ["claude", "codex", "opencode", "remote"];

const CHAT_SUGGESTIONS = [
  "What should we focus on this week?",
  "Review our current marketing plan",
  "Where are we losing momentum?",
];

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
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const driver = execution?.driver;
  const model = execution?.model;
  const providerModels = useProviderModels(driver ?? null);
  const activeMeta = driver ? PROVIDER_META[driver] : null;
  const activeModel =
    providerModels.models.find((option) => option.value === model)?.label ??
    model ??
    "Auto";

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
              className="text-muted-foreground hover:bg-accent hover:text-foreground border px-2.5 py-1.5 text-xs transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      <div className="bg-card/80 border backdrop-blur-lg">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Message Chief…"
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
