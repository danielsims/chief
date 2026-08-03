import type { ReactNode } from "react";
import { useState } from "react";
import {
  ChevronRight,
  Copy,
  Info,
  LogOut,
  Pin,
  PinOff,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@chief/ui/components/button";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@chief/ui/components/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

import type { WorkspaceChannelId } from "../lib/workspace-channels";
import type { SidebarChannel } from "./channel-browser-dialog";

interface ChannelActionsProps {
  canDelete: boolean;
  channel: SidebarChannel;
  onDelete: () => void;
  onLeave: () => void;
  onPinChange: (pinned: boolean) => void;
  onSearch: () => void;
  onViewDetails: () => void;
}

function copyChannelName(channel: SidebarChannel) {
  return navigator.clipboard.writeText(`#${channel.label}`);
}

function deferChannelAction(action: () => void) {
  window.setTimeout(action, 0);
}

function ChannelActionIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4"
    >
      {children}
    </span>
  );
}

const channelActionClass =
  "min-h-9 gap-2 rounded-lg py-2 pr-4 pl-2 text-sm font-normal leading-5";

export function ChannelContextActions({
  canDelete,
  pinned,
  channel,
  onDelete,
  onLeave,
  onPinChange,
  onSearch,
  onViewDetails,
}: ChannelActionsProps & { pinned: boolean }) {
  return (
    <>
      <ContextMenuItem
        className={channelActionClass}
        onSelect={() => void copyChannelName(channel)}
      >
        <ChannelActionIcon>
          <Copy />
        </ChannelActionIcon>
        <span>Copy channel name</span>
      </ContextMenuItem>
      <ContextMenuItem
        className={channelActionClass}
        onSelect={() => onPinChange(!pinned)}
      >
        <ChannelActionIcon>{pinned ? <PinOff /> : <Pin />}</ChannelActionIcon>
        <span>{pinned ? "Remove from pinned" : "Pin channel"}</span>
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger className={channelActionClass}>
          <ChannelActionIcon>
            <Info />
          </ChannelActionIcon>
          <span className="flex-1">Channel details</span>
          <ChevronRight className="text-muted-foreground ml-auto size-4" />
        </ContextMenuSubTrigger>
        <ContextMenuSubContent sideOffset={8}>
          <ContextMenuItem
            className={channelActionClass}
            onSelect={() => deferChannelAction(onViewDetails)}
          >
            <ChannelActionIcon>
              <Info />
            </ChannelActionIcon>
            <span>View channel details</span>
          </ContextMenuItem>
          <ContextMenuItem
            className={channelActionClass}
            onSelect={() => deferChannelAction(onSearch)}
          >
            <ChannelActionIcon>
              <Search />
            </ChannelActionIcon>
            <span>Search in channel</span>
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        className={`${channelActionClass} text-destructive data-[highlighted]:bg-destructive/[0.08] data-[highlighted]:text-destructive`}
        onSelect={() => deferChannelAction(onLeave)}
      >
        <ChannelActionIcon>
          <LogOut />
        </ChannelActionIcon>
        <span>Leave channel</span>
      </ContextMenuItem>
      {canDelete ? (
        <ContextMenuItem
          className={`${channelActionClass} text-destructive data-[highlighted]:bg-destructive/[0.08] data-[highlighted]:text-destructive`}
          onSelect={() => deferChannelAction(onDelete)}
        >
          <ChannelActionIcon>
            <Trash2 />
          </ChannelActionIcon>
          <span>Delete channel</span>
        </ContextMenuItem>
      ) : null}
    </>
  );
}

export function ChannelPopoverActions({
  canDelete,
  channel,
  onDelete,
  onLeave,
  onPinChange,
  onSearch,
  onViewDetails,
}: ChannelActionsProps) {
  return (
    <>
      <button
        type="button"
        className="hover:bg-muted/50 flex min-h-9 w-full items-center gap-2 rounded-lg py-2 pr-4 pl-2 text-left text-sm leading-5 font-normal transition-colors outline-none"
        onClick={() => void copyChannelName(channel)}
      >
        <ChannelActionIcon>
          <Copy />
        </ChannelActionIcon>
        <span>Copy channel name</span>
      </button>
      <button
        type="button"
        className="hover:bg-muted/50 flex min-h-9 w-full items-center gap-2 rounded-lg py-2 pr-4 pl-2 text-left text-sm leading-5 font-normal transition-colors outline-none"
        onClick={() => onPinChange(true)}
      >
        <ChannelActionIcon>
          <Pin />
        </ChannelActionIcon>
        <span>Pin channel</span>
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="hover:bg-muted/50 data-[state=open]:bg-muted/50 flex min-h-9 w-full items-center gap-2 rounded-lg py-2 pr-2 pl-2 text-left text-sm leading-5 font-normal transition-colors outline-none"
          >
            <ChannelActionIcon>
              <Info />
            </ChannelActionIcon>
            <span className="flex-1">Channel details</span>
            <ChevronRight className="text-muted-foreground size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-56 p-1"
        >
          <button
            type="button"
            className="hover:bg-muted/50 flex min-h-9 w-full items-center gap-2 rounded-lg py-2 pr-4 pl-2 text-left text-sm leading-5 transition-colors outline-none"
            onClick={() => deferChannelAction(onViewDetails)}
          >
            <ChannelActionIcon>
              <Info />
            </ChannelActionIcon>
            <span>View channel details</span>
          </button>
          <button
            type="button"
            className="hover:bg-muted/50 flex min-h-9 w-full items-center gap-2 rounded-lg py-2 pr-4 pl-2 text-left text-sm leading-5 transition-colors outline-none"
            onClick={() => deferChannelAction(onSearch)}
          >
            <ChannelActionIcon>
              <Search />
            </ChannelActionIcon>
            <span>Search in channel</span>
          </button>
        </PopoverContent>
      </Popover>
      <div className="bg-muted -mx-1 my-1 h-px" />
      <button
        type="button"
        className="text-destructive hover:bg-destructive/[0.08] flex min-h-9 w-full items-center gap-2 rounded-lg py-2 pr-4 pl-2 text-left text-sm leading-5 font-normal transition-colors outline-none"
        onClick={() => deferChannelAction(onLeave)}
      >
        <ChannelActionIcon>
          <LogOut />
        </ChannelActionIcon>
        <span>Leave channel</span>
      </button>
      {canDelete ? (
        <button
          type="button"
          className="text-destructive hover:bg-destructive/[0.08] flex min-h-9 w-full items-center gap-2 rounded-lg py-2 pr-4 pl-2 text-left text-sm leading-5 font-normal transition-colors outline-none"
          onClick={() => deferChannelAction(onDelete)}
        >
          <ChannelActionIcon>
            <Trash2 />
          </ChannelActionIcon>
          <span>Delete channel</span>
        </button>
      ) : null}
    </>
  );
}

export function ChannelDeleteDialog({
  channel,
  onClose,
  onDelete,
}: {
  channel: SidebarChannel | null;
  onClose: () => void;
  onDelete: (channelId: WorkspaceChannelId) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  return (
    <Dialog
      open={channel !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {channel ? `Delete #${channel.label}?` : "Delete channel?"}
          </DialogTitle>
          <DialogDescription className="leading-5">
            This permanently deletes the channel, its messages, reactions,
            threads, and agent conversation history. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-destructive text-xs leading-5">{error}</p>
        ) : null}
        <DialogFooter>
          <Button disabled={deleting} variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={deleting}
            variant="destructive"
            onClick={() => {
              if (!channel) return;
              setDeleting(true);
              setError(null);
              void onDelete(channel.id)
                .then(onClose)
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Chief could not delete this channel.",
                  ),
                )
                .finally(() => setDeleting(false));
            }}
          >
            Delete channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
