import type { KeyboardEvent } from "react";
import { useState } from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";

import type {
  Database,
  DatabaseRow,
  DatabaseRowSave,
  DatabaseValue,
} from "@chief/relay-contracts";
import { cellAsText } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { cn } from "@chief/ui/lib/utils";

import type { DatabasePersonOption } from "./database-model";
import { DocumentEditor } from "../files/document-editor";
import { bareFieldClass, CellEditor } from "./database-cells";
import { fieldIcon, personOf, titleField } from "./database-model";

/** What the dialog opens on: a row to edit, or the cells a new row starts with. */
export type RowDialogTarget = DatabaseRow | { values: DatabaseRow["values"] };

const pillClass =
  "inline-flex h-7 max-w-56 items-center gap-1.5 rounded-full border border-foreground/[0.09] px-2.5 text-[12px] text-foreground/80 outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-sky-500/30 data-[state=open]:bg-foreground/[0.05]";

function sameValue(
  left: DatabaseValue | undefined,
  right: DatabaseValue | undefined,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Creating and editing a row, in one place: its title, page and every other
 * field, saved with the button or Command-Enter.
 */
export function DatabaseRowDialog({
  database,
  target,
  people,
  onClose,
  onSubmit,
  onRemove,
  onOpenSource,
}: {
  database: Database;
  target: RowDialogTarget;
  people: readonly DatabasePersonOption[];
  onClose: () => void;
  onSubmit: (change: DatabaseRowSave) => void;
  onRemove: (row: DatabaseRow) => void;
  onOpenSource: (row: DatabaseRow) => void;
}) {
  const row = "id" in target ? target : undefined;
  const title = titleField(database);
  const [values, setValues] = useState(target.values);
  const [body, setBody] = useState(row?.body ?? "");
  const titleText = cellAsText(values[title?.id ?? ""]) ?? "";
  const changedValues = Object.fromEntries(
    database.fields.flatMap((field) =>
      sameValue(values[field.id], row?.values[field.id] ?? undefined)
        ? []
        : [[field.id, values[field.id] ?? null]],
    ),
  );
  const ready =
    Boolean(titleText.trim()) &&
    (!row || Object.keys(changedValues).length > 0 || body.trim() !== row.body);
  const submit = () => {
    if (!ready) return;
    onSubmit({
      ...(row ? { id: row.id } : undefined),
      values: changedValues,
      body: body.trim(),
    });
  };
  const setValue = (fieldId: string, value: DatabaseValue | null) =>
    setValues((current) => {
      const next = { ...current };
      if (value === null || value === "") delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
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
        // Opening a row to read it shouldn't select its title.
        onOpenAutoFocus={(event) => {
          if (row) event.preventDefault();
        }}
        className="top-[22%] w-[calc(100%-32px)] max-w-[560px] translate-y-0 gap-0 overflow-hidden rounded-xl p-0"
      >
        <DialogTitle className="sr-only">
          {row ? "Edit" : "New"} {database.name}
        </DialogTitle>
        <div className="px-5 pt-4">
          <p className="text-muted-foreground flex items-center gap-1 text-[12px]">
            {database.name}
            <ChevronRight size={12} />
            <span className="text-foreground/80">{row ? "Edit" : "New"}</span>
          </p>
          <input
            autoFocus={!row}
            aria-label={title?.name ?? "Title"}
            value={titleText}
            maxLength={200}
            placeholder={title?.name ?? "Title"}
            className={cn(
              bareFieldClass,
              "mt-3 text-[18px] leading-7 font-medium tracking-[-0.015em]",
            )}
            onChange={(event) =>
              title && setValue(title.id, event.target.value)
            }
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
              value={body}
              placeholder="Add a description…"
              onChange={setBody}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-5 pt-1 pb-4">
          {database.fields.slice(1).map((field) => {
            const Icon = fieldIcon(field.type);
            return (
              <CellEditor
                key={field.id}
                field={field}
                value={values[field.id]}
                people={people}
                className={pillClass}
                placeholder={
                  <span className="inline-flex items-center gap-1.5">
                    <Icon size={12} />
                    {field.name}
                  </span>
                }
                onChange={(value) => setValue(field.id, value)}
              />
            );
          })}
          {row?.source ? (
            <button
              type="button"
              className={pillClass}
              onClick={() => onOpenSource(row)}
            >
              {row.source.kind === "thread" ? "Open thread" : "Open automation"}
              <ArrowUpRight size={12} />
            </button>
          ) : null}
        </div>
        <footer className="flex items-center gap-2 border-t border-black/[0.055] px-5 py-3 dark:border-white/[0.06]">
          {row ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive -ml-2.5"
              onClick={() => onRemove(row)}
            >
              Delete
            </Button>
          ) : null}
          {row?.createdBy ? (
            <span className="text-muted-foreground truncate text-[11px]">
              Added by{" "}
              {personOf(people, row.createdBy)?.name ??
                (row.createdBy.kind === "agent" ? "an agent" : "someone")}
            </span>
          ) : null}
          <span className="text-muted-foreground ml-auto text-[11px]">⌘↵</span>
          <Button size="sm" disabled={!ready} onClick={submit}>
            {row ? "Save" : "Create"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
