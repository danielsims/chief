import type { KeyboardEvent, ReactNode } from "react";
import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowUpRight, MoreHorizontal, Plus } from "lucide-react";

import type {
  BoardItem,
  BoardLane,
  BoardLaneColor,
} from "@chief/relay-contracts";
import { boardLaneColors } from "@chief/relay-contracts";
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

import { AgentAvatar } from "../components/agent-avatar";
import { insetBandClass, insetCardClass } from "../components/inset-card";
import { UserAvatar } from "../components/user-avatar";

/** Notes as one line of plain text, for a card's preview. */
function plainNotes(markdown: string) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^```.*$/gmu, "")
    .replace(/^\s{0,3}(?:#{1,6}\s|>\s?|[-*+]\s|\d+\.\s)/gmu, "")
    .replace(/[*_~`]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

const laneColorClass: Record<BoardLaneColor, string> = {
  gray: "bg-zinc-400",
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  purple: "bg-violet-500",
};

const laneColorName: Record<BoardLaneColor, string> = {
  gray: "Gray",
  blue: "Blue",
  green: "Green",
  amber: "Amber",
  red: "Red",
  purple: "Purple",
};

/** Someone an item can be assigned to: a person or an agent. */
export interface BoardPerson {
  kind: "user" | "agent";
  id: string;
  name: string;
  image?: string;
}

export function AssigneeAvatar({ person }: { person: BoardPerson }) {
  return person.kind === "agent" ? (
    <AgentAvatar
      agentId={person.id}
      label={person.name}
      className="size-4 rounded-full"
    />
  ) : (
    <UserAvatar
      image={person.image}
      name={person.name}
      className="size-4 rounded-full text-[8px]"
    />
  );
}

/** A lane's colour, as a small dot beside its name. */
export function LaneDot({
  color,
  className,
}: {
  color: BoardLaneColor;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        laneColorClass[color],
        className,
      )}
    />
  );
}

/** A lane's drop target, for dragging into an empty lane. */
const laneDropId = (laneId: string) => `lane:${laneId}`;

/**
 * Text typed straight onto the board: no box, border or focus fill, so it
 * reads as the card or lane it is becoming.
 */
const bareFieldClass =
  "block w-full min-w-0 resize-none border-0 bg-transparent p-0 shadow-none outline-none placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-0";

/** A field that commits on Enter or blur and backs out on Escape. */
export function InlineField({
  initial = "",
  placeholder,
  maxLength,
  multiline = false,
  className,
  onCommit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  className?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const trimmed = value.trim();
    if (commit && trimmed && trimmed !== initial) onCommit(trimmed);
    else onCancel();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    }
    if (event.key === "Escape") finish(false);
  };
  const shared = {
    autoFocus: true,
    value,
    placeholder,
    maxLength,
    onKeyDown,
    onBlur: () => finish(true),
  };
  return multiline ? (
    <textarea
      {...shared}
      rows={2}
      className={cn(bareFieldClass, "field-sizing-content", className)}
      onChange={(event) => setValue(event.target.value)}
    />
  ) : (
    <input
      {...shared}
      className={cn(bareFieldClass, className)}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

export function ItemCard({
  item,
  assignee,
  overlay = false,
  dragListeners,
  onOpen,
  onOpenSource,
}: {
  item: BoardItem;
  assignee?: BoardPerson;
  overlay?: boolean;
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  onOpen?: () => void;
  onOpenSource?: () => void;
}) {
  return (
    <div
      {...dragListeners}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (onOpen && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        insetCardClass,
        "block w-full cursor-grab text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40",
        overlay && "cursor-grabbing shadow-lg",
      )}
    >
      <p className="text-[13px] leading-[18px] font-medium tracking-[-0.01em] break-words">
        {item.title}
      </p>
      {item.notes ? (
        <p className="text-muted-foreground mt-1 line-clamp-2 text-[12px] leading-4 break-words">
          {plainNotes(item.notes)}
        </p>
      ) : null}
      {assignee || item.source ? (
        <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-[11px]">
          {assignee ? (
            <>
              <AssigneeAvatar person={assignee} />
              <span className="truncate">{assignee.name}</span>
            </>
          ) : null}
          {item.source ? (
            // While dragging, the card is a picture of itself: same label,
            // nothing to click.
            <button
              type="button"
              disabled={!onOpenSource}
              className="hover:text-foreground ml-auto flex shrink-0 items-center gap-0.5 transition-colors disabled:pointer-events-none"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onOpenSource?.();
              }}
            >
              {item.source.kind === "thread" ? "Thread" : "Automation"}
              <ArrowUpRight size={11} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SortableItem(props: {
  item: BoardItem;
  assignee?: BoardPerson;
  onOpen: () => void;
  onOpenSource: () => void;
}) {
  // Cards are dragged with the pointer; the card itself stays the one
  // focusable control, opened with Enter.
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.item.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
    >
      <ItemCard {...props} dragListeners={listeners} />
    </li>
  );
}

export function Lane({
  lane,
  ids,
  items,
  index,
  laneCount,
  onAdd,
  onRename,
  onRecolor,
  onMove,
  onRemove,
  children,
}: {
  lane: BoardLane;
  ids: string[];
  items: ReadonlyMap<string, BoardItem>;
  index: number;
  laneCount: number;
  onAdd: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: BoardLaneColor) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
  children: (item: BoardItem) => ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: laneDropId(lane.id) });
  const [renaming, setRenaming] = useState(false);
  return (
    <section
      className={cn(
        insetBandClass,
        "flex max-h-full max-w-[300px] min-w-[208px] flex-1 basis-0 flex-col",
      )}
    >
      <header className="flex h-8 items-center gap-1.5 pr-0.5 pl-2.5">
        <LaneDot color={lane.color} />
        {renaming ? (
          <InlineField
            initial={lane.name}
            placeholder="Lane name"
            maxLength={40}
            className="text-[12px] leading-5 font-medium"
            onCommit={(name) => {
              setRenaming(false);
              onRename(name);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            className="min-w-0 truncate text-[12px] font-medium"
            onClick={() => setRenaming(true)}
          >
            {lane.name}
          </button>
        )}
        {!renaming ? (
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {ids.length}
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground ml-auto size-6"
              aria-label={`${lane.name} options`}
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
                {boardLaneColors.map((color) => (
                  <DropdownMenuItem
                    key={color}
                    onSelect={() => onRecolor(color)}
                  >
                    <LaneDot color={color} />
                    {laneColorName[color]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={index === 0}
              onSelect={() => onMove(-1)}
            >
              Move left
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === laneCount - 1}
              onSelect={() => onMove(1)}
            >
              Move right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={laneCount === 1}
              className="text-destructive"
              onSelect={onRemove}
            >
              Remove lane
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className="flex min-h-10 flex-1 flex-col gap-1 overflow-y-auto"
        >
          {ids.flatMap((id) => {
            const item = items.get(id);
            return item ? [children(item)] : [];
          })}
        </ul>
      </SortableContext>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1 px-2.5 text-[12px] transition-colors"
        onClick={onAdd}
      >
        <Plus size={13} />
        Add item
      </button>
    </section>
  );
}
