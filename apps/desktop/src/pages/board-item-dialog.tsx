import type { KeyboardEvent, ReactNode } from "react";
import { Fragment, useState } from "react";
import { ArrowUpRight, ChevronRight, UserRound } from "lucide-react";

import type {
  BoardItem,
  BoardItemSave,
  BoardLane,
} from "@chief/relay-contracts";
import { boardAssigneeSchema } from "@chief/relay-contracts";
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

import type { BoardPerson } from "./board-parts";
import { DocumentEditor } from "../components/files/document-editor";
import { AssigneeAvatar, LaneDot } from "./board-parts";

/** What the dialog opens on: an item to edit, or a lane to add one to. */
export interface BoardItemDialogTarget {
  item?: BoardItem;
  lane: string;
}

const fieldClass =
  "block w-full min-w-0 resize-none border-0 bg-transparent p-0 shadow-none outline-none placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-0";

const pillClass =
  "inline-flex h-7 max-w-48 items-center gap-1.5 rounded-full border border-foreground/[0.09] px-2.5 text-[12px] text-foreground/80 outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-sky-500/30 data-[state=open]:bg-foreground/[0.05]";

function Pill({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={pillClass}>
        {icon}
        <span className="truncate">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Creating and editing a board item, in one place: title, description and
 * where it sits, saved with the button or Command-Enter.
 */
export function BoardItemDialog({
  target,
  lanes,
  people,
  onClose,
  onSubmit,
  onRemove,
  onOpenSource,
}: {
  target: BoardItemDialogTarget;
  lanes: readonly BoardLane[];
  people: readonly BoardPerson[];
  onClose: () => void;
  onSubmit: (change: BoardItemSave) => void;
  onRemove: (item: BoardItem) => void;
  onOpenSource: (item: BoardItem) => void;
}) {
  const { item } = target;
  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [lane, setLane] = useState(item?.lane ?? target.lane);
  const [assignee, setAssignee] = useState(item?.assignee);
  const current = lanes.find((candidate) => candidate.id === lane);
  const laneName = current?.name;
  const laneColor = current?.color;
  const person = people.find(
    (candidate) =>
      candidate.kind === assignee?.kind && candidate.id === assignee.id,
  );
  const changed =
    !item ||
    title.trim() !== item.title ||
    notes.trim() !== item.notes ||
    lane !== item.lane ||
    assignee?.kind !== item.assignee?.kind ||
    assignee?.id !== item.assignee?.id;
  const ready = Boolean(title.trim()) && changed;
  const submit = () => {
    if (!ready) return;
    onSubmit({
      ...(item ? { id: item.id } : undefined),
      title: title.trim(),
      notes: notes.trim(),
      lane,
      assignee: assignee ?? null,
    });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onKeyDown={onKeyDown}
        // Opening an item to read it shouldn't select its title.
        onOpenAutoFocus={(event) => {
          if (item) event.preventDefault();
        }}
        className="top-[22%] w-[calc(100%-32px)] max-w-[560px] translate-y-0 gap-0 overflow-hidden rounded-xl p-0"
      >
        <DialogTitle className="sr-only">
          {item ? "Edit item" : "New item"}
        </DialogTitle>
        <div className="px-5 pt-4">
          <p className="text-muted-foreground flex items-center gap-1 text-[12px]">
            Board
            <ChevronRight size={12} />
            <span className="text-foreground/80">
              {item ? (laneName ?? "Item") : "New item"}
            </span>
          </p>
          <input
            autoFocus={!item}
            aria-label="Title"
            value={title}
            maxLength={200}
            placeholder="Item title"
            className={cn(
              fieldClass,
              "mt-3 text-[18px] leading-7 font-medium tracking-[-0.015em]",
            )}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="mt-2 max-h-[40vh] overflow-y-auto">
            <DocumentEditor
              compact
              value={notes}
              placeholder="Add description…"
              onChange={setNotes}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-5 pt-1 pb-4">
          <Pill
            icon={laneColor ? <LaneDot color={laneColor} /> : null}
            label={laneName ?? "Lane"}
          >
            {lanes.map((candidate) => (
              <DropdownMenuItem
                key={candidate.id}
                onSelect={() => setLane(candidate.id)}
              >
                <LaneDot color={candidate.color} />
                {candidate.name}
              </DropdownMenuItem>
            ))}
          </Pill>
          <Pill
            icon={
              person ? (
                <AssigneeAvatar person={person} />
              ) : (
                <UserRound size={12} className="text-muted-foreground" />
              )
            }
            label={person?.name ?? "Assign"}
          >
            {people.map((candidate, index) => (
              <Fragment key={`${candidate.kind}:${candidate.id}`}>
                {index > 0 && candidate.kind !== people[index - 1]?.kind ? (
                  <DropdownMenuSeparator />
                ) : null}
                <DropdownMenuItem
                  onSelect={() =>
                    setAssignee(
                      boardAssigneeSchema.parse({
                        kind: candidate.kind,
                        id: candidate.id,
                      }),
                    )
                  }
                >
                  <AssigneeAvatar person={candidate} />
                  {candidate.name}
                </DropdownMenuItem>
              </Fragment>
            ))}
            {assignee ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAssignee(undefined)}>
                  Unassign
                </DropdownMenuItem>
              </>
            ) : null}
          </Pill>
          {item?.source ? (
            <button
              type="button"
              className={pillClass}
              onClick={() => onOpenSource(item)}
            >
              {item.source.kind === "thread"
                ? "Open thread"
                : "Open automation"}
              <ArrowUpRight size={12} />
            </button>
          ) : null}
        </div>
        <footer className="flex items-center gap-2 border-t border-black/[0.055] px-5 py-3 dark:border-white/[0.06]">
          {item ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive -ml-2.5"
              onClick={() => onRemove(item)}
            >
              Delete
            </Button>
          ) : null}
          <span className="text-muted-foreground ml-auto text-[11px]">⌘↵</span>
          <Button size="sm" disabled={!ready} onClick={submit}>
            {item ? "Save" : "Create item"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
