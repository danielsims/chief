import { useState } from "react";
import { Hash, Plus } from "lucide-react";

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
  description: string;
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
  onOpenChannel: (channelId: WorkspaceChannelId) => void;
  onCreateChannel: (name: string, description?: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const close = () => {
    setCreating(false);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setCreating(false);
      }}
    >
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="px-5 pt-5 pb-4">
          <DialogTitle>
            {creating ? "Create a channel" : "Browse channels"}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {creating
              ? "Give this work a durable shared place."
              : "Open an existing channel or make a new one."}
          </DialogDescription>
        </div>
        {creating ? (
          <form
            className="space-y-4 px-5 pb-5"
            onSubmit={(event) => {
              event.preventDefault();
              const channelName = name.trim();
              if (!channelName) return;
              onCreateChannel(channelName, description.trim() || undefined);
              setName("");
              setDescription("");
              close();
            }}
          >
            <label className="block space-y-1.5 text-xs font-medium">
              Name
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="launch-planning"
                className="bg-card h-10 w-full rounded-xl px-3 text-sm font-normal shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)] outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_28%,transparent)]"
              />
            </label>
            <label className="block space-y-1.5 text-xs font-medium">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What belongs in this channel?"
                rows={3}
                className="bg-card w-full resize-none rounded-xl px-3 py-2.5 text-sm font-normal shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)] outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_28%,transparent)]"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="hover:bg-accent h-9 rounded-lg px-3 text-xs font-medium"
              >
                Back
              </button>
              <button
                type="submit"
                className="bg-foreground text-background h-9 rounded-lg px-3 text-xs font-medium"
              >
                Create channel
              </button>
            </div>
          </form>
        ) : (
          <div className="pb-3">
            <div className="px-4 pb-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search channels"
                className="bg-muted h-9 w-full rounded-lg px-3 text-xs outline-none"
              />
            </div>
            <div className="max-h-72 overflow-y-auto px-2">
              {channels
                .filter((channel) =>
                  `${channel.label} ${channel.description}`
                    .toLocaleLowerCase()
                    .includes(query.trim().toLocaleLowerCase()),
                )
                .map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => {
                      onOpenChannel(channel.id);
                      close();
                    }}
                    className="hover:bg-accent flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left"
                  >
                    <Hash size={15} className="text-muted-foreground mt-0.5" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">
                        {channel.label}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                        {channel.description}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
            <div className="bg-border/60 mx-4 my-2 h-px" />
            <div className="px-2">
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="hover:bg-accent flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-medium"
              >
                <Plus size={14} /> Create a new channel
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
