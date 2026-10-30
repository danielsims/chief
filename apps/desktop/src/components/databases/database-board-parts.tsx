import type { ReactNode } from "react";
import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreHorizontal, Plus } from "lucide-react";

import type {
  DatabaseColor,
  DatabaseOption,
  DatabaseRow,
} from "@chief/relay-contracts";
import { databaseColors } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
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
import { cn } from "@chief/ui/lib/utils";

import type { DatabasePersonOption } from "./database-model";
import { insetBandClass, insetCardClass } from "../inset-card";
import { ColorDot, InlineField, PersonAvatar } from "./database-cells";
import { colorName, plainText } from "./database-model";

/** A lane's drop target, for dragging into an empty lane. */
export const laneDropId = (laneId: string) => `lane:${laneId}`;

/** What a card shows: the row's title, page and who it's for. */
export interface CardContent {
  row: DatabaseRow;
  title: string;
  assignee?: DatabasePersonOption;
  details?: { label: string; text: string }[];
}

export function RowCard({
  card,
  overlay = false,
  dragListeners,
  onOpen,
  selected = false,
}: {
  card: CardContent;
  overlay?: boolean;
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  onOpen?: () => void;
  selected?: boolean;
}) {
  const { row, title, assignee } = card;
  return (
    <div
      {...dragListeners}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-pressed={onOpen ? selected : undefined}
      data-selected={selected || undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (onOpen && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        insetCardClass,
        "block w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40",
        selected && "ring-2 ring-sky-500 ring-inset",
        overlay && "cursor-grabbing shadow-lg",
      )}
    >
      <p
        className={cn(
          "text-[13px] leading-[18px] font-medium tracking-[-0.01em] break-words",
          !title && "text-muted-foreground",
        )}
      >
        {title || "Untitled"}
      </p>
      {row.body ? (
        <p className="text-muted-foreground mt-1 line-clamp-2 text-[12px] leading-4 break-words">
          {plainText(row.body)}
        </p>
      ) : null}
      {card.details?.length ? (
        <div className="mt-3 space-y-2">
          {card.details.map((detail) => (
            <div key={detail.label}>
              <p className="text-muted-foreground/70 text-[10px]">
                {detail.label}
              </p>
              <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[12px] leading-[18px] break-words">
                {detail.text}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {assignee ? (
        <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-[11px]">
          <PersonAvatar person={assignee} />
          <span className="truncate">{assignee.name}</span>
        </div>
      ) : null}
    </div>
  );
}

export function SortableCard(props: {
  card: CardContent;
  onOpen: () => void;
  selected?: boolean;
}) {
  // Cards are dragged with the pointer; the card itself stays the one
  // focusable control, opened with Enter.
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.card.row.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
    >
      <RowCard {...props} dragListeners={listeners} />
    </li>
  );
}

/**
 * A column of cards: one option of the field the board groups by, or the
 * rows with none, which can't be renamed or removed.
 */
export function Lane({
  laneId,
  option,
  name,
  ids,
  first,
  last,
  canRemove,
  onAdd,
  onChange,
  onMove,
  onRemove,
  children,
}: {
  laneId: string;
  option?: DatabaseOption;
  name: string;
  ids: string[];
  first: boolean;
  last: boolean;
  canRemove: boolean;
  onAdd: () => void;
  onChange: (option: DatabaseOption) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
  children: (id: string) => ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: laneDropId(laneId) });
  const [renaming, setRenaming] = useState(false);
  return (
    <section
      className={cn(
        insetBandClass,
        "flex max-h-full max-w-[300px] min-w-[208px] flex-1 basis-0 flex-col",
      )}
    >
      <header className="flex h-8 items-center gap-1.5 pr-0.5 pl-2.5">
        {option ? <ColorDot color={option.color} /> : null}
        {renaming && option ? (
          <InlineField
            initial={option.name}
            placeholder="Name"
            maxLength={40}
            className="text-[12px] leading-5 font-medium"
            onCommit={(next) => {
              setRenaming(false);
              if (next) onChange({ ...option, name: next });
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : option ? (
          <button
            type="button"
            className="min-w-0 truncate text-[12px] font-medium"
            onClick={() => setRenaming(true)}
          >
            {name}
          </button>
        ) : (
          <span className="text-muted-foreground min-w-0 truncate text-[12px] font-medium">
            {name}
          </span>
        )}
        {!renaming ? (
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {ids.length}
          </span>
        ) : null}
        {option ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground ml-auto size-6"
                aria-label={`${name} options`}
              >
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            {/* Keeps focus off the trigger, so the rename field stays open. */}
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                Rename
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Colour</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {databaseColors.map((color: DatabaseColor) => (
                    <DropdownMenuItem
                      key={color}
                      onSelect={() => onChange({ ...option, color })}
                    >
                      <ColorDot color={color} />
                      {colorName[color]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
                Move left
              </DropdownMenuItem>
              <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
                Move right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canRemove}
                className="text-destructive"
                onSelect={onRemove}
              >
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className="flex min-h-10 flex-1 flex-col gap-1 overflow-y-auto"
        >
          {ids.map((id) => children(id))}
        </ul>
      </SortableContext>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1 px-2.5 text-[12px] transition-colors"
        onClick={onAdd}
      >
        <Plus size={13} />
        Add
      </button>
    </section>
  );
}
