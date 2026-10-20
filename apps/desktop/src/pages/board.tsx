import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type {
  Board,
  BoardItem,
  BoardItemSave,
  BoardLane,
} from "@chief/relay-contracts";
import { maximumBoardLanes } from "@chief/relay-contracts";

import type { BoardItemDialogTarget } from "./board-item-dialog";
import type { BoardPerson } from "./board-parts";
import { useWorkspaceUsers } from "../components/chat/mention-people-context";
import { insetBandClass } from "../components/inset-card";
import { PageHeader } from "../components/page-header";
import { useChiefNavigation } from "../lib/chief-navigation-context";
import { parseRelayError } from "../lib/relay-runtime-errors";
import { useRelaySession } from "../lib/relay-session-context";
import { useRuntime } from "../lib/runtime";
import { BoardItemDialog } from "./board-item-dialog";
import { InlineField, ItemCard, Lane, SortableItem } from "./board-parts";

type Columns = Record<string, string[]>;

// Matches the lanes' own max width and the gap between them.
const laneMaxWidth = 300;
const laneGap = 12;
const addLaneWidth = 240;

/** Item ids by lane, in board order. */
function columnsOf(board: Board): Columns {
  const columns: Columns = Object.fromEntries(
    board.lanes.map((lane) => [lane.id, []]),
  );
  for (const item of board.items) columns[item.lane]?.push(item.id);
  return columns;
}

function laneOf(columns: Columns, id: string) {
  if (id.startsWith("lane:")) return id.slice(5);
  return Object.keys(columns).find((lane) => columns[lane]?.includes(id));
}

/** A position between an item's new neighbours, so only it is saved. */
function positionAt(
  ids: readonly string[],
  index: number,
  items: ReadonlyMap<string, BoardItem>,
) {
  const before = items.get(ids[index - 1] ?? "")?.position;
  const after = items.get(ids[index + 1] ?? "")?.position;
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + 1;
  if (after !== undefined) return after - 1;
  return 0;
}

function failure(error: Error, fallback: string) {
  return error.message || fallback;
}

export function BoardPage() {
  const { client } = useRelaySession();
  const { agents } = useRuntime();
  const users = useWorkspaceUsers();
  const navigate = useNavigate();
  const chiefNavigation = useChiefNavigation();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [dragColumns, setDragColumns] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<BoardItemDialogTarget | null>(null);
  const [addingLane, setAddingLane] = useState(false);
  // Refreshes wait while something is being dragged or saved, so an
  // in-flight change isn't overwritten by an older copy.
  const busy = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const refresh = useCallback(() => {
    if (!client || busy.current) return;
    void client.board.get().then(
      (next) => {
        if (busy.current) return;
        setBoard(next);
        setError("");
      },
      (cause) =>
        setError(
          failure(
            parseRelayError(cause),
            "Couldn't load the board. Check your connection.",
          ),
        ),
    );
  }, [client]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const run = async <T,>(work: () => Promise<T>, message: string) => {
    busy.current += 1;
    try {
      return await work();
    } catch (cause) {
      toast.error(failure(parseRelayError(cause), message));
      return undefined;
    } finally {
      busy.current -= 1;
    }
  };

  const saveItem = async (change: BoardItemSave) => {
    if (!client) return;
    const saved = await run(
      () => client.board.save(change),
      "Couldn't save that item.",
    );
    if (saved)
      setBoard((current) =>
        current
          ? {
              ...current,
              items: [
                ...current.items.filter((item) => item.id !== saved.id),
                saved,
              ].sort((left, right) => left.position - right.position),
            }
          : current,
      );
    else refresh();
  };

  const saveLanes = async (lanes: BoardLane[], message: string) => {
    if (!client) return;
    const next = await run(() => client.board.saveLanes(lanes), message);
    if (next) setBoard(next);
    return Boolean(next);
  };

  if (!board)
    return (
      <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] flex-col">
        <PageHeader title="Board" />
        {error ? (
          <p className="text-destructive px-6 text-sm">{error}</p>
        ) : null}
      </div>
    );

  const items = new Map(board.items.map((item) => [item.id, item]));
  const columns = dragColumns ?? columnsOf(board);
  const { lanes } = board;

  const onDragStart = ({ active }: DragStartEvent) => {
    busy.current += 1;
    setActiveId(String(active.id));
    setDragColumns(columnsOf(board));
  };

  // Moving across lanes happens while dragging, so the card shows where it lands.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragColumns) return;
    const id = String(active.id);
    const from = laneOf(dragColumns, id);
    const to = laneOf(dragColumns, String(over.id));
    if (!from || !to || from === to) return;
    const target = dragColumns[to] ?? [];
    const overIndex = target.indexOf(String(over.id));
    setDragColumns({
      ...dragColumns,
      [from]: (dragColumns[from] ?? []).filter((other) => other !== id),
      [to]: [
        ...target.slice(0, overIndex < 0 ? target.length : overIndex),
        id,
        ...target.slice(overIndex < 0 ? target.length : overIndex),
      ],
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const final = dragColumns;
    setActiveId(null);
    setDragColumns(null);
    busy.current -= 1;
    const item = items.get(id);
    const lane = final && laneOf(final, id);
    if (!over || !final || !item || !lane) return;
    let ids = final[lane] ?? [];
    const overIndex = ids.indexOf(String(over.id));
    if (overIndex >= 0) ids = arrayMove(ids, ids.indexOf(id), overIndex);
    const position = positionAt(ids, ids.indexOf(id), items);
    if (lane === item.lane && position === item.position) return;
    // Show the move straight away; the save confirms it.
    setBoard({
      ...board,
      items: board.items
        .map((other) =>
          other.id === id ? { ...other, lane, position } : other,
        )
        .sort((left, right) => left.position - right.position),
    });
    void saveItem({ id, lane, position });
  };

  const onDragCancel = () => {
    setActiveId(null);
    setDragColumns(null);
    busy.current -= 1;
  };

  const openSource = (item: BoardItem) => {
    if (item.source?.kind === "thread")
      chiefNavigation.open({
        kind: "conversation",
        channelId: item.source.conversationId,
        threadRootId: item.source.threadRootId,
      });
    else if (item.source?.kind === "automation")
      void navigate(
        `/schedule/automations/${encodeURIComponent(item.source.scheduleId)}`,
      );
  };

  const moveLane = (index: number, offset: number) =>
    void saveLanes(
      arrayMove([...lanes], index, index + offset),
      "Couldn't move that lane.",
    );

  const removeLane = (lane: BoardLane) => {
    const count = columns[lane.id]?.length ?? 0;
    const remaining = lanes.filter((other) => other.id !== lane.id);
    void saveLanes(remaining, "Couldn't remove that lane.").then((saved) => {
      if (saved && count)
        toast(
          `Moved ${count} ${count === 1 ? "item" : "items"} to ${remaining[0]?.name}.`,
        );
    });
  };

  const active = activeId ? items.get(activeId) : undefined;
  // People first, then agents, as the assignee picker lists them.
  const people: BoardPerson[] = [
    ...[...users.values()].map((user) => ({
      kind: "user" as const,
      id: user.id,
      name: user.name,
      ...(user.image ? { image: user.image } : undefined),
    })),
    ...agents
      .flatMap((agent) => [agent, ...(agent.subagents ?? [])])
      .map(({ id, name }) => ({ kind: "agent" as const, id, name })),
  ];
  const assigneeOf = (item: BoardItem) =>
    people.find(
      (person) =>
        person.kind === item.assignee?.kind && person.id === item.assignee.id,
    );
  const canAddLane = lanes.length < maximumBoardLanes;

  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <PageHeader
        title="Board"
        description="What your agents are working on, and what needs you."
      />
      {error ? (
        <p className="text-destructive px-6 pb-2 text-sm">{error}</p>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex min-h-0 flex-1 overflow-x-auto px-6 pb-6">
          {/* As wide as the lanes can grow, centred in any room left over. */}
          <div
            className="mx-auto flex w-full min-w-min items-start gap-3"
            style={{
              maxWidth:
                lanes.length * (laneMaxWidth + laneGap) +
                (canAddLane ? addLaneWidth : -laneGap),
            }}
          >
            {lanes.map((lane, index) => (
              <Lane
                key={lane.id}
                lane={lane}
                ids={columns[lane.id] ?? []}
                items={items}
                index={index}
                laneCount={lanes.length}
                onAdd={() => setDialog({ lane: lane.id })}
                onRename={(name) =>
                  void saveLanes(
                    lanes.map((other) =>
                      other.id === lane.id ? { ...other, name } : other,
                    ),
                    "Couldn't rename that lane.",
                  )
                }
                onRecolor={(color) =>
                  void saveLanes(
                    lanes.map((other) =>
                      other.id === lane.id ? { ...other, color } : other,
                    ),
                    "Couldn't recolour that lane.",
                  )
                }
                onMove={(offset) => moveLane(index, offset)}
                onRemove={() => removeLane(lane)}
              >
                {(item) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    assignee={assigneeOf(item)}
                    onOpen={() => setDialog({ item, lane: item.lane })}
                    onOpenSource={() => openSource(item)}
                  />
                )}
              </Lane>
            ))}
            {canAddLane ? (
              <div className="shrink-0" style={{ width: addLaneWidth }}>
                {addingLane ? (
                  <div className={insetBandClass}>
                    <div className="flex h-8 items-center px-2.5">
                      <InlineField
                        placeholder="Lane name"
                        maxLength={40}
                        className="text-[12px] leading-5 font-medium"
                        onCommit={(name) => {
                          setAddingLane(false);
                          void saveLanes(
                            [
                              ...lanes,
                              {
                                id: `lane-${crypto.randomUUID().slice(0, 8)}`,
                                name,
                                color: "gray",
                              },
                            ],
                            "Couldn't add that lane.",
                          );
                        }}
                        onCancel={() => setAddingLane(false)}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground flex h-9 items-center gap-1 px-2.5 text-[12px] transition-colors"
                    onClick={() => setAddingLane(true)}
                  >
                    <Plus size={13} />
                    Add lane
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <DragOverlay>
          {active ? (
            <ItemCard item={active} assignee={assigneeOf(active)} overlay />
          ) : null}
        </DragOverlay>
      </DndContext>
      {dialog ? (
        <BoardItemDialog
          key={dialog.item?.id ?? `new:${dialog.lane}`}
          target={dialog}
          lanes={lanes}
          people={people}
          onClose={() => setDialog(null)}
          onSubmit={(change) => {
            setDialog(null);
            void saveItem(change);
          }}
          onOpenSource={(item) => {
            setDialog(null);
            openSource(item);
          }}
          onRemove={(item) => {
            setDialog(null);
            if (!client) return;
            void run(
              () => client.board.remove(item.id),
              "Couldn't delete that item.",
            ).then((result) => {
              if (result)
                setBoard((current) =>
                  current
                    ? {
                        ...current,
                        items: current.items.filter(
                          (other) => other.id !== item.id,
                        ),
                      }
                    : current,
                );
            });
          }}
        />
      ) : null}
    </div>
  );
}
