import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { useRef, useState } from "react";
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

import type {
  DatabaseField,
  DatabaseOption,
  DatabaseRow,
} from "@chief/relay-contracts";
import { cellAsText, databaseLimits } from "@chief/relay-contracts";

import type { CardContent } from "./database-board-parts";
import type { DatabasePersonOption } from "./database-model";
import type { DatabaseState } from "./use-database";
import { insetBandClass } from "../inset-card";
import { Lane, RowCard, SortableCard } from "./database-board-parts";
import { InlineField } from "./database-cells";
import {
  firstField,
  newKey,
  personOf,
  positionBetween,
  titleOf,
} from "./database-model";

type Columns = Record<string, string[]>;
type SelectField = Extract<DatabaseField, { type: "select" }>;

/** The lane for rows with no value in the field the board groups by. */
const noneLane = ":none";

// Matches the lanes' own max width and the gap between them.
const laneMaxWidth = 300;
const laneGap = 12;
const addLaneWidth = 240;

function laneOf(columns: Columns, id: string) {
  if (id.startsWith("lane:")) return id.slice(5);
  return Object.keys(columns).find((lane) => columns[lane]?.includes(id));
}

/**
 * Rows as cards in a lane per option of a select field, dragged between
 * lanes to change it. Lanes are the field's options, edited in place.
 */
export function DatabaseBoard({
  state,
  rows,
  group,
  people,
  onOpenRow,
  onOpenSource,
}: {
  state: DatabaseState;
  rows: readonly DatabaseRow[];
  group: SelectField;
  people: readonly DatabasePersonOption[];
  onOpenRow: (row: DatabaseRow | { values: DatabaseRow["values"] }) => void;
  onOpenSource: (row: DatabaseRow) => void;
}) {
  const database = state.data?.database;
  const [dragColumns, setDragColumns] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addingLane, setAddingLane] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  if (!database) return null;

  const assigneeField = firstField(database, "person");
  const cards = new Map<string, CardContent>(
    rows.map((row) => [
      row.id,
      {
        row,
        title: titleOf(database, row),
        assignee: personOf(people, row.values[assigneeField?.id ?? ""]),
      },
    ]),
  );
  const options = group.options;
  const laneFor = (row: DatabaseRow) => {
    const value = cellAsText(row.values[group.id]);
    return options.find((option) => option.id === value)?.id ?? noneLane;
  };
  const columnsNow: Columns = { [noneLane]: [] };
  for (const option of options) columnsNow[option.id] = [];
  for (const row of rows) columnsNow[laneFor(row)]?.push(row.id);
  const columns = dragColumns ?? columnsNow;
  // Rows with no value only get a lane while there are some.
  const lanes = [
    ...(columns[noneLane]?.length || !options.length ? [noneLane] : []),
    ...options.map((option) => option.id),
  ];

  const saveOptions = (next: DatabaseOption[], message: string) =>
    void state.saveDatabase(
      {
        fields: database.fields.map((field) =>
          field.id === group.id ? { ...group, options: next } : field,
        ),
      },
      message,
    );

  const onDragStart = ({ active }: DragStartEvent) => {
    release.current = state.hold();
    setActiveId(String(active.id));
    setDragColumns(columnsNow);
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
    const at = overIndex < 0 ? target.length : overIndex;
    setDragColumns({
      ...dragColumns,
      [from]: (dragColumns[from] ?? []).filter((other) => other !== id),
      [to]: [...target.slice(0, at), id, ...target.slice(at)],
    });
  };

  const endDrag = () => {
    setActiveId(null);
    setDragColumns(null);
    release.current?.();
    release.current = null;
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const final = dragColumns;
    endDrag();
    const row = cards.get(id)?.row;
    const lane = final && laneOf(final, id);
    if (!over || !final || !row || !lane) return;
    let ids = final[lane] ?? [];
    const overIndex = ids.indexOf(String(over.id));
    if (overIndex >= 0) ids = arrayMove(ids, ids.indexOf(id), overIndex);
    const index = ids.indexOf(id);
    const position = positionBetween(
      cards.get(ids[index - 1] ?? "")?.row.position,
      cards.get(ids[index + 1] ?? "")?.row.position,
    );
    const value = lane === noneLane ? undefined : lane;
    if (value === row.values[group.id] && position === row.position) return;
    const values = { ...row.values };
    if (value === undefined) delete values[group.id];
    else values[group.id] = value;
    // Show the move straight away; the save confirms it.
    state.placeRow({ ...row, values, position });
    void state.saveRow({
      id,
      position,
      values: { [group.id]: value ?? null },
    });
  };

  const active = activeId ? cards.get(activeId) : undefined;
  const canAddLane = options.length < databaseLimits.options;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={endDrag}
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
          {lanes.map((laneId) => {
            const index = options.findIndex((option) => option.id === laneId);
            const option = options[index];
            return (
              <Lane
                key={laneId}
                laneId={laneId}
                option={option}
                name={option?.name ?? `No ${group.name.toLowerCase()}`}
                ids={columns[laneId] ?? []}
                first={index <= 0}
                last={index === options.length - 1}
                canRemove={Boolean(option)}
                onAdd={() =>
                  onOpenRow({ values: option ? { [group.id]: option.id } : {} })
                }
                onChange={(next) =>
                  saveOptions(
                    options.map((other) =>
                      other.id === next.id ? next : other,
                    ),
                    "Couldn't change that lane.",
                  )
                }
                onMove={(offset) =>
                  saveOptions(
                    arrayMove([...options], index, index + offset),
                    "Couldn't move that lane.",
                  )
                }
                onRemove={() =>
                  saveOptions(
                    options.filter((other) => other.id !== laneId),
                    "Couldn't remove that lane.",
                  )
                }
              >
                {(id) => {
                  const card = cards.get(id);
                  return card ? (
                    <SortableCard
                      key={id}
                      card={card}
                      onOpen={() => onOpenRow(card.row)}
                      onOpenSource={() => onOpenSource(card.row)}
                    />
                  ) : null;
                }}
              </Lane>
            );
          })}
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
                        if (name)
                          saveOptions(
                            [
                              ...options,
                              { id: newKey("option"), name, color: "gray" },
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
        {active ? <RowCard card={active} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
