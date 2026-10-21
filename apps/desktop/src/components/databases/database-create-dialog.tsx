import { useState } from "react";
import { Columns3, Hash, Lock } from "lucide-react";
import { toast } from "sonner";

import type { Database } from "@chief/relay-contracts";
import { boardTemplate } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@chief/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { cn } from "@chief/ui/lib/utils";

import { parseRelayError } from "../../lib/relay-runtime-errors";
import { useRelaySession } from "../../lib/relay-session-context";
import { useWorkspaceChannels } from "../../lib/workspace-channels-context";
import { bareFieldClass } from "./database-cells";

const pillClass =
  "border-foreground/[0.09] text-foreground/80 hover:bg-foreground/[0.04] inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] outline-none transition-colors data-[state=open]:bg-foreground/[0.05] aria-checked:border-foreground/30 aria-checked:bg-foreground/[0.05] aria-checked:text-foreground";

const tableTemplate = (): Pick<Database, "fields" | "views"> => ({
  fields: [{ id: "title", name: "Name", type: "title" }],
  views: [{ id: "table", name: "Table", layout: "table" }],
});

/** The channels a database can be kept to. */
export function useChannelChoices() {
  const { channels } = useWorkspaceChannels();
  return channels.filter(
    (channel) =>
      channel.lifecycle === "active" &&
      (channel.visibility === "public" || channel.visibility === "private") &&
      !channel.directUserId,
  );
}

/**
 * Starts a board for the workspace or one channel, or, from a channel, a
 * database in it.
 */
export function DatabaseCreateDialog({
  conversationId,
  onClose,
  onCreated,
}: {
  /** The channel it's made from; without one, a board, kept where you pick. */
  conversationId?: string;
  onClose: () => void;
  onCreated: (database: Database) => void;
}) {
  const { client } = useRelaySession();
  const choices = useChannelChoices();
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState(conversationId);
  const [saving, setSaving] = useState(false);
  const channel = choices.find((candidate) => candidate.id === channelId);
  const ready = Boolean(name.trim() && client && !saving);

  const submit = async () => {
    if (!ready || !client) return;
    setSaving(true);
    try {
      onCreated(
        await client.databases.save({
          name: name.trim(),
          ...(channelId ? { conversationId: channelId } : undefined),
          // A channel makes databases; boards are made on Boards.
          ...(conversationId ? tableTemplate() : boardTemplate()),
        }),
      );
    } catch (cause) {
      toast.error(parseRelayError(cause).message || "Couldn't create that.");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="top-[22%] w-[calc(100%-32px)] max-w-[440px] translate-y-0 gap-0 overflow-hidden rounded-xl p-0"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <DialogTitle className="sr-only">
          {conversationId ? "New database" : "New board"}
        </DialogTitle>
        <div className="space-y-4 px-5 pt-5 pb-4">
          <input
            autoFocus
            aria-label="Name"
            value={name}
            maxLength={80}
            placeholder={conversationId ? "Database name" : "Board name"}
            className={cn(
              bareFieldClass,
              "text-[16px] leading-6 font-medium tracking-[-0.01em]",
            )}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {conversationId ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger className={pillClass}>
                  {!channel ? (
                    <Columns3 size={12} />
                  ) : channel.visibility === "private" ? (
                    <Lock size={12} />
                  ) : (
                    <Hash size={12} />
                  )}
                  {channel?.name ?? "Whole workspace"}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-72 min-w-48 overflow-y-auto"
                >
                  <DropdownMenuItem onSelect={() => setChannelId(undefined)}>
                    <Columns3 size={13} />
                    Whole workspace
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {choices.map((choice) => (
                    <DropdownMenuItem
                      key={choice.id}
                      onSelect={() => setChannelId(choice.id)}
                    >
                      {choice.visibility === "private" ? (
                        <Lock size={13} />
                      ) : (
                        <Hash size={13} />
                      )}
                      {choice.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {!conversationId ? (
            <p className="text-muted-foreground text-[12px] leading-5">
              {channel
                ? "Only the channel's members, people and agents, can use it."
                : "Everyone in the workspace, people and agents, can use it."}
            </p>
          ) : null}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-black/[0.055] px-5 py-3 dark:border-white/[0.06]">
          <Button size="sm" disabled={!ready} onClick={() => void submit()}>
            Create
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
