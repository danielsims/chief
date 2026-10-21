import { useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { Maximize2, MoreHorizontal, Plus } from "lucide-react";

import type { DatabaseField, DatabaseRow } from "@chief/relay-contracts";
import { databaseLimits } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { cn } from "@chief/ui/lib/utils";

import type { DatabasePersonOption } from "./database-model";
import type { DatabaseState } from "./use-database";
import { CellEditor, InlineField } from "./database-cells";
import { DatabaseFieldDialog } from "./database-field-dialog";
import { fieldIcon } from "./database-model";

const cellClass =
  "flex h-9 w-full min-w-0 items-center px-2.5 text-left text-[13px] outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] data-[state=open]:bg-foreground/[0.04]";

const headerCellClass =
  "flex h-8 w-full min-w-0 items-center gap-1.5 px-2.5 text-left text-[12px] text-muted-foreground outline-none hover:bg-foreground/[0.03] data-[state=open]:bg-foreground/[0.04]";

/** Rows as a grid of cells, each edited in place, with fields as columns. */
export function DatabaseTable({
  state,
  rows,
  people,
  onOpenRow,
}: {
  state: DatabaseState;
  rows: readonly DatabaseRow[];
  people: readonly DatabasePersonOption[];
  onOpenRow: (row: DatabaseRow) => void;
}) {
  const database = state.data?.database;
  const [editingField, setEditingField] = useState<DatabaseField | "new">();
  const [adding, setAdding] = useState(false);
  if (!database) return null;
  const { fields } = database;
  const columns = `minmax(240px,2fr) repeat(${fields.length - 1}, minmax(160px,1fr)) 40px`;
  const saveFields = (next: DatabaseField[], message: string) =>
    void state.saveDatabase({ fields: next }, message);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
      <div
        role="table"
        aria-label={database.name}
        className="mx-auto min-w-min text-[13px]"
        style={{ maxWidth: 240 + (fields.length - 1) * 220 + 40 }}
      >
        <div
          role="row"
          className="border-foreground/[0.07] grid border-b"
          style={{ gridTemplateColumns: columns }}
        >
          {fields.map((field, index) => {
            const Icon = fieldIcon(field.type);
            return (
              <DropdownMenu key={field.id}>
                <DropdownMenuTrigger
                  role="columnheader"
                  className={headerCellClass}
                >
                  <Icon size={12} className="shrink-0" />
                  <span className="truncate">{field.name}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => setEditingField(field)}>
                    Edit field
                  </DropdownMenuItem>
                  {index > 0 ? (
                    <>
                      <DropdownMenuItem
                        disabled={index === 1}
                        onSelect={() =>
                          saveFields(
                            arrayMove([...fields], index, index - 1),
                            "Couldn't move that field.",
                          )
                        }
                      >
                        Move left
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={index === fields.length - 1}
                        onSelect={() =>
                          saveFields(
                            arrayMove([...fields], index, index + 1),
                            "Couldn't move that field.",
                          )
                        }
                      >
                        Move right
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        disabled={database.views.some(
                          (view) => view.groupBy === field.id,
                        )}
                        onSelect={() =>
                          saveFields(
                            fields.filter((other) => other.id !== field.id),
                            "Couldn't delete that field.",
                          )
                        }
                      >
                        Delete field
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
          {fields.length < databaseLimits.fields ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground m-auto size-6"
              aria-label="Add field"
              title="Add field"
              onClick={() => setEditingField("new")}
            >
              <Plus size={14} />
            </Button>
          ) : (
            <span />
          )}
        </div>
        {rows.map((row) => (
          <div
            key={row.id}
            role="row"
            className="group border-foreground/[0.05] grid border-b"
            style={{ gridTemplateColumns: columns }}
          >
            {fields.map((field, index) => (
              <div key={field.id} role="cell" className="relative min-w-0">
                <CellEditor
                  field={field}
                  value={row.values[field.id]}
                  people={people}
                  className={cn(cellClass, index === 0 && "pr-9 font-medium")}
                  placeholder={index === 0 ? "Untitled" : ""}
                  onChange={(value) =>
                    void state.saveRow({
                      id: row.id,
                      values: { [field.id]: value },
                    })
                  }
                />
                {index === 0 ? (
                  <button
                    type="button"
                    aria-label="Open"
                    title="Open"
                    className="bg-background text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)] group-hover:flex focus-visible:flex"
                    onClick={() => onOpenRow(row)}
                  >
                    <Maximize2 size={11} />
                  </button>
                ) : null}
              </div>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Row options"
                className="text-muted-foreground hover:text-foreground m-auto flex size-6 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onOpenRow(row)}>
                  Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={() => void state.removeRow(row)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {adding ? (
          <div className="flex h-9 items-center px-2.5">
            <InlineField
              placeholder={fields[0]?.name ?? "Name"}
              maxLength={200}
              className="text-[13px] font-medium"
              onCommit={(title) => {
                setAdding(false);
                if (title && fields[0])
                  void state.saveRow({
                    values: { [fields[0].id]: title },
                    // New rows in a table go last, where they were typed.
                    position:
                      Math.max(0, ...rows.map((other) => other.position)) + 1,
                  });
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex h-9 items-center gap-1.5 px-2.5 text-[13px] transition-colors"
            onClick={() => setAdding(true)}
          >
            <Plus size={13} />
            New
          </button>
        )}
      </div>
      {editingField ? (
        <DatabaseFieldDialog
          field={editingField === "new" ? undefined : editingField}
          typeLocked={
            editingField !== "new" &&
            database.views.some((view) => view.groupBy === editingField.id)
          }
          onClose={() => setEditingField(undefined)}
          onSubmit={(field) => {
            setEditingField(undefined);
            saveFields(
              editingField === "new"
                ? [...fields, field]
                : fields.map((other) =>
                    other.id === field.id ? field : other,
                  ),
              "Couldn't save that field.",
            );
          }}
        />
      ) : null}
    </div>
  );
}
