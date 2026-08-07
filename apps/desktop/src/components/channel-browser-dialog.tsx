import { useState } from "react";
import { ArrowLeft, Hash, Plus, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@chief/ui/components/dialog";

import type { WorkspaceChannelId } from "../lib/workspace-channels";

export interface SidebarChannel {
  id: WorkspaceChannelId;
  label: string;
  topic: string;
  description: string;
  agentIds: string[];
  createdAt?: number;
}

function cleanChannelName(value: string) {
  return value.trim().replace(/^#+/, "").trim();
}

export function ChannelBrowserDialog({
  channels,
  open,
  onOpenChange,
  onOpenChannel,
  onCreateChannel,
}: {
  channels: SidebarChannel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChannel: (
    channelId: WorkspaceChannelId,
    options?: { focusComposer?: boolean },
  ) => void;
  onCreateChannel: (
    name: string,
    description?: string,
  ) => Promise<WorkspaceChannelId | null>;
}) {
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const channelName = cleanChannelName(query);
  const normalizedQuery = channelName.toLocaleLowerCase();
  const exactMatch = channels.find(
    (channel) =>
      channel.label.toLocaleLowerCase() === channelName.toLocaleLowerCase(),
  );
  const matchingChannels = channels.filter((channel) =>
    `${channel.label} ${channel.description}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
  const canQuickCreate = channelName.length > 0 && exactMatch === undefined;

  const reset = () => {
    setCreating(false);
    setSubmitting(false);
    setQuery("");
    setName("");
    setDescription("");
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const create = async (nextName: string, nextDescription?: string) => {
    const cleanedName = cleanChannelName(nextName);
    if (!cleanedName || submitting) return;
    const cleanedDescription = nextDescription?.trim();
    setSubmitting(true);
    const channelId = await onCreateChannel(
      cleanedName,
      cleanedDescription === "" ? undefined : cleanedDescription,
    );
    if (!channelId) {
      setSubmitting(false);
      return;
    }
    onOpenChannel(channelId, { focusComposer: true });
    close();
  };

  const openChannel = (channelId: WorkspaceChannelId) => {
    onOpenChannel(channelId);
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
        } else {
          close();
        }
      }}
    >
      <DialogContent className="max-w-lg gap-0 overflow-hidden rounded-2xl p-0">
        {creating ? (
          <form
            className="flex h-[420px] max-h-[70vh] flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void create(name, description);
            }}
          >
            <div className="flex items-center gap-2 px-5 pt-5 pb-4">
              <button
                type="button"
                aria-label="Back to channels"
                onClick={() => setCreating(false)}
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors"
              >
                <ArrowLeft size={15} />
              </button>
              <div>
                <DialogTitle>New channel</DialogTitle>
                <DialogDescription className="sr-only">
                  Create a shared place for your team and agents.
                </DialogDescription>
              </div>
            </div>
            <div className="space-y-5 px-5 py-4">
              <label className="block space-y-2 text-xs font-medium">
                Channel name
                <div className="bg-muted/55 flex h-11 items-center gap-2.5 rounded-xl px-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_24%,transparent)]">
                  <Hash className="text-muted-foreground size-4 shrink-0" />
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="launch-planning"
                    className="min-w-0 flex-1 bg-transparent text-sm font-normal outline-none"
                  />
                </div>
              </label>
              <label className="block space-y-2 text-xs font-medium">
                Description{" "}
                <span className="text-muted-foreground">· Optional</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What will your team work on here?"
                  rows={4}
                  className="bg-muted/55 w-full resize-none rounded-xl px-3 py-2.5 text-sm font-normal shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_24%,transparent)]"
                />
              </label>
            </div>
            <div className="mt-auto flex items-center justify-end gap-2 border-t px-5 py-4">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-muted-foreground hover:bg-accent hover:text-foreground h-9 rounded-lg px-3 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!cleanChannelName(name) || submitting}
                className="bg-foreground text-background h-9 rounded-lg px-3.5 text-xs font-medium disabled:opacity-40"
              >
                Create channel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex h-[440px] max-h-[70vh] flex-col">
            <div className="px-5 pt-5 pb-4">
              <DialogTitle>Browse channels</DialogTitle>
              <DialogDescription className="sr-only">
                Search existing channels or create a new one.
              </DialogDescription>
              <label className="bg-muted/55 mt-4 flex h-11 items-center gap-2.5 rounded-xl px-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_24%,transparent)]">
                <Search className="text-muted-foreground size-4 shrink-0" />
                <input
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing)
                      return;
                    event.preventDefault();
                    if (exactMatch) {
                      openChannel(exactMatch.id);
                    } else if (canQuickCreate) {
                      void create(channelName);
                    }
                  }}
                  placeholder="Search or create a channel"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {canQuickCreate ? (
                <button
                  type="button"
                  onClick={() => void create(channelName)}
                  className="bg-muted/30 hover:bg-muted/60 mb-3 flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] transition-colors"
                >
                  <span className="bg-foreground/[0.065] flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <Plus size={14} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    Create channel{" "}
                    <strong className="font-semibold">“{channelName}”</strong>
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    Enter
                  </span>
                </button>
              ) : null}

              {matchingChannels.length > 0 ? (
                <div className="bg-muted/20 divide-border/60 divide-y overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
                  {matchingChannels.map((channel) => (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() => openChannel(channel.id)}
                      className="hover:bg-muted/55 flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors"
                    >
                      <Hash
                        size={15}
                        className="text-muted-foreground mt-0.5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">
                          {channel.label}
                        </span>
                        <span className="text-muted-foreground mt-0.5 line-clamp-1 block text-[11px]">
                          {channel.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : query.trim() && !canQuickCreate ? (
                <p className="text-muted-foreground px-4 py-12 text-center text-xs">
                  No channels match your search.
                </p>
              ) : null}
            </div>

            {!query.trim() ? (
              <div className="border-t px-4 py-3">
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="hover:bg-accent flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-xs font-medium transition-colors"
                >
                  <Plus size={14} /> Create a new channel
                </button>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
