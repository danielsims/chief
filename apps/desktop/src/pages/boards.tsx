import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Columns3,
  Hash,
  Lock,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import type { Database } from "@chief/relay-contracts";
import { workspaceBoardId } from "@chief/relay-contracts";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { Input } from "@chief/ui/components/input";

import {
  DatabaseCreateDialog,
  useChannelChoices,
} from "../components/databases/database-create-dialog";
import { DatabaseDeleteDialog } from "../components/databases/database-delete-dialog";
import { isBoard } from "../components/databases/database-model";
import { DatabaseView } from "../components/databases/database-view";
import {
  announceDatabasesChanged,
  usePrefetchDatabase,
} from "../components/databases/use-database";
import { PageHeader } from "../components/page-header";
import { parseRelayError } from "../lib/relay-runtime-errors";
import { useRelaySession } from "../lib/relay-session-context";
import { useWorkspaceChannels } from "../lib/workspace-channels-context";

/** The workspace's boards, with the workspace board first. */
function boardsOf(databases: readonly Database[]) {
  return databases
    .filter(isBoard)
    .sort(
      (left, right) =>
        Number(right.id === workspaceBoardId) -
          Number(left.id === workspaceBoardId) ||
        left.name.localeCompare(right.name),
    );
}

// The last list read, per workspace, so the page opens at once.
const listed = new Map<string, Database[]>();

export function BoardsPage() {
  const { client, snapshot } = useRelaySession();
  const { channels } = useWorkspaceChannels();
  const prefetch = usePrefetchDatabase();
  const [params, setParams] = useSearchParams();
  const workspaceId = snapshot?.id ?? "";
  const [boards, setBoards] = useState<Database[] | null>(
    () => listed.get(workspaceId) ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Database | null>(null);
  const [renaming, setRenaming] = useState<Database | null>(null);

  useEffect(() => {
    if (boards) listed.set(workspaceId, boards);
  }, [boards, workspaceId]);

  const load = useCallback(
    () =>
      client?.databases.list().then(
        (databases) => setBoards(boardsOf(databases)),
        (cause) =>
          toast.error(
            parseRelayError(cause).message || "Couldn't load your boards.",
          ),
      ),
    [client],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const select = (id: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id === workspaceBoardId) next.delete("board");
      else next.set("board", id);
      return next;
    });
  const board =
    boards?.find((candidate) => candidate.id === params.get("board")) ??
    boards?.[0];
  const channelOf = (database: Database) =>
    channels.find((channel) => channel.id === database.conversationId);
  const choices = useChannelChoices();
  const placeIcon = (database: Database) =>
    !database.conversationId ? (
      <Columns3 size={13} />
    ) : channelOf(database)?.visibility === "private" ? (
      <Lock size={13} />
    ) : (
      <Hash size={13} />
    );
  const change = (
    target: Database,
    update: { conversationId?: string | null; name?: string },
  ) =>
    void client?.databases.save({ id: target.id, ...update }).then(
      (saved) => {
        setBoards((current) =>
          boardsOf(
            (current ?? []).map((other) =>
              other.id === saved.id ? saved : other,
            ),
          ),
        );
        announceDatabasesChanged();
      },
      (cause) =>
        toast.error(
          parseRelayError(cause).message || "Couldn't change that board.",
        ),
    );

  const picker = board ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-64">
          <span className="truncate">{board.name}</span>
          <ChevronDown size={13} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 min-w-56 overflow-y-auto"
      >
        {boards?.map((candidate) => (
          <DropdownMenuItem
            key={candidate.id}
            onSelect={() => select(candidate.id)}
            onPointerEnter={() => prefetch(candidate.id)}
          >
            <span className="text-muted-foreground">
              {placeIcon(candidate)}
            </span>
            <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
            {candidate.id === board.id ? <Check size={13} /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setCreating(true)}>
          <Plus size={13} />
          New board
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setRenaming(board)}>
          <Pencil size={13} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {placeIcon(board)}
            {channelOf(board)
              ? `#${channelOf(board)?.name}`
              : "Whole workspace"}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            <DropdownMenuItem
              onSelect={() => change(board, { conversationId: null })}
            >
              <Columns3 size={13} />
              Whole workspace
              {!board.conversationId ? (
                <Check size={13} className="ml-auto" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {choices.map((channel) => (
              <DropdownMenuItem
                key={channel.id}
                onSelect={() => change(board, { conversationId: channel.id })}
              >
                {channel.visibility === "private" ? (
                  <Lock size={13} />
                ) : (
                  <Hash size={13} />
                )}
                {channel.name}
                {board.conversationId === channel.id ? (
                  <Check size={13} className="ml-auto" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {board.id !== workspaceBoardId ? (
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => setDeleting(board)}
          >
            <Trash2 size={13} />
            Delete {board.name}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <PageHeader title="Boards" />
      {board ? (
        <DatabaseView
          key={board.id}
          databaseId={board.id}
          boardOnly
          leading={picker}
          newLabel="New action item"
        />
      ) : null}
      {creating ? (
        <DatabaseCreateDialog
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            announceDatabasesChanged();
            setBoards((current) => boardsOf([...(current ?? []), created]));
            select(created.id);
          }}
        />
      ) : null}
      {renaming ? (
        <RenameDialog
          key={renaming.id}
          name={renaming.name}
          onClose={() => setRenaming(null)}
          onRename={(name) => {
            setRenaming(null);
            change(renaming, { name });
          }}
        />
      ) : null}
      {deleting ? (
        <DatabaseDeleteDialog
          database={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            announceDatabasesChanged();
            select(workspaceBoardId);
            setBoards((current) =>
              (current ?? []).filter((other) => other.id !== deleting.id),
            );
          }}
        />
      ) : null}
    </div>
  );
}

function RenameDialog({
  name,
  onClose,
  onRename,
}: {
  name: string;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  const ready = Boolean(value.trim()) && value.trim() !== name;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100%-32px)] max-w-[400px] gap-4 rounded-xl p-5">
        <DialogTitle className="text-[15px] font-medium">
          Rename board
        </DialogTitle>
        <Input
          autoFocus
          aria-label="Board name"
          value={value}
          maxLength={80}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && ready) onRename(value.trim());
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!ready}
            onClick={() => onRename(value.trim())}
          >
            Rename
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
