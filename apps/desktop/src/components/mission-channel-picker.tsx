import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Hash, Plus, Search } from "lucide-react";

import type { WorkspaceChannel } from "@chief/agent-runtime/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

function cleanChannelName(value: string) {
  return value.trim().replace(/^#+/, "").trim();
}

/** Selects an existing channel or creates one from the same searchable field. */
export function MissionChannelPicker({
  channels,
  disabled,
  onCreate,
  onSelect,
  value,
}: {
  channels: WorkspaceChannel[];
  disabled?: boolean;
  onCreate: (name: string) => Promise<void>;
  onSelect: (channelId: string) => Promise<void>;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const selected = channels.find((channel) => channel.id === value);
  const channelName = cleanChannelName(query);
  const normalizedQuery = channelName.toLocaleLowerCase();
  const exactMatch = channels.find(
    (channel) => channel.name.toLocaleLowerCase() === normalizedQuery,
  );
  const matchingChannels = useMemo(
    () =>
      channels.filter((channel) =>
        `${channel.name} ${channel.description}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      ),
    [channels, normalizedQuery],
  );
  const canCreate = channelName.length > 0 && !exactMatch;
  const optionCount = matchingChannels.length + (canCreate ? 1 : 0);

  const close = () => {
    setOpen(false);
    setQuery("");
    setHighlightedIndex(0);
  };

  const choose = async (channelId: string) => {
    await onSelect(channelId);
    close();
  };

  const create = async () => {
    if (!canCreate) return;
    await onCreate(channelName);
    close();
  };

  const activateHighlighted = () => {
    if (canCreate && highlightedIndex === 0) return create();
    const index = highlightedIndex - (canCreate ? 1 : 0);
    const channel = matchingChannels[index];
    if (channel) return choose(channel.id);
    return Promise.resolve();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setHighlightedIndex(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          aria-expanded={open}
          className="bg-muted/55 focus-visible:ring-foreground/15 flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] transition-shadow focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          disabled={disabled}
          role="combobox"
          type="button"
        >
          <Hash className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {selected?.name ?? "Choose a channel"}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <label className="border-border/70 flex h-11 items-center gap-2.5 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && optionCount > 0) {
                event.preventDefault();
                setHighlightedIndex((index) => (index + 1) % optionCount);
              } else if (event.key === "ArrowUp" && optionCount > 0) {
                event.preventDefault();
                setHighlightedIndex(
                  (index) => (index - 1 + optionCount) % optionCount,
                );
              } else if (event.key === "Enter" && optionCount > 0) {
                event.preventDefault();
                void activateHighlighted();
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
            placeholder="Search or create a channel"
            spellCheck={false}
            value={query}
          />
        </label>
        <div className="max-h-64 overflow-y-auto p-1.5">
          {canCreate ? (
            <button
              className={cn(
                "hover:bg-accent flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                highlightedIndex === 0 && "bg-accent",
              )}
              onClick={() => void create()}
              type="button"
            >
              <Plus className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Create <strong className="font-medium">#{channelName}</strong>
              </span>
            </button>
          ) : null}
          {matchingChannels.map((channel, index) => {
            const optionIndex = index + (canCreate ? 1 : 0);
            return (
              <button
                className={cn(
                  "hover:bg-accent flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                  optionIndex === highlightedIndex && "bg-accent",
                )}
                key={channel.id}
                onClick={() => void choose(channel.id)}
                type="button"
              >
                <Hash className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {channel.name}
                  </span>
                  {channel.description ? (
                    <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                      {channel.description}
                    </span>
                  ) : null}
                </span>
                <Check
                  className={cn(
                    "text-muted-foreground mt-0.5 size-4 shrink-0",
                    channel.id === value ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
          {optionCount === 0 ? (
            <p className="text-muted-foreground px-3 py-8 text-center text-xs">
              No channels match that search.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
