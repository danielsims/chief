import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useBlocker } from "react-router";

import type {
  Database,
  DatabaseRow,
  DatabaseRowSave,
  DatabaseValue,
} from "@chief/relay-contracts";
import { cellAsNumber, cellAsText } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";

import type { DatabasePersonOption } from "./database-model";
import {
  ConversationAuxiliaryPanel,
  ConversationAuxiliaryPanelHeader,
  useConversationAuxiliaryPanelSizing,
} from "../chat/conversation-auxiliary-panel";
import { DocumentEditor } from "../files/document-editor";
import { WorkspaceSidePanel } from "../workspace-side-panel";
import { bareFieldClass, CellEditor } from "./database-cells";
import { fieldIcon, titleField, titleOf } from "./database-model";

export type RowPanelTarget = DatabaseRow | { values: DatabaseRow["values"] };

/** The full record remains readable beside its table or board, with typed editors. */
export function DatabaseRowPanel({
  database,
  target,
  initialField,
  people,
  closingRequested,
  onKeepEditing,
  onClose,
  onSubmit,
  onRemove,
  onOpenSource,
}: {
  database: Database;
  target: RowPanelTarget;
  initialField?: string;
  people: readonly DatabasePersonOption[];
  closingRequested?: boolean;
  onKeepEditing: () => void;
  onClose: () => void;
  onSubmit: (change: DatabaseRowSave) => Promise<DatabaseRow | undefined>;
  onRemove: (row: DatabaseRow) => void;
  onOpenSource: (row: DatabaseRow) => void;
}) {
  const row = "id" in target ? target : undefined;
  const title = titleField(database);
  const [values, setValues] = useState(target.values);
  const [body, setBody] = useState(row?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const sizing = useConversationAuxiliaryPanelSizing();
  useEffect(() => {
    const field = initialField
      ? panel.current?.querySelector<HTMLElement>(
          `[data-field="${CSS.escape(initialField)}"]`,
        )
      : undefined;
    field?.scrollIntoView({ block: "nearest" });
    // Read the requested field without selecting or replacing its text.
    (field ?? panel.current)?.focus({ preventScroll: true });
  }, [initialField]);
  const changed = Object.fromEntries(
    database.fields.flatMap((field) =>
      JSON.stringify(values[field.id] ?? null) ===
      JSON.stringify(row?.values[field.id] ?? null)
        ? []
        : [[field.id, values[field.id] ?? null]],
    ),
  );
  const dirty = Object.keys(changed).length > 0 || body !== (row?.body ?? "");
  // Channel artifact tabs are query-only transitions on the same pathname.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (dirty || saving) &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
  );
  const navigationBlocked = blocker.state === "blocked";
  const keepEditing = () => {
    if (blocker.state === "blocked") blocker.reset();
    setConfirmClose(false);
    onKeepEditing();
  };
  const discardChanges = () => {
    if (blocker.state === "blocked") {
      onClose();
      blocker.proceed();
    } else onClose();
  };
  const ready =
    Boolean(cellAsText(values[title?.id ?? ""])?.trim()) && (!row || dirty);
  const setValue = (id: string, value: DatabaseValue | null) =>
    setValues((current) => {
      const next = { ...current };
      if (value === null) delete next[id];
      else next[id] = value;
      return next;
    });
  const close = () => {
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  useEffect(() => {
    if (!closingRequested || saving) return;
    if (!dirty) onClose();
  }, [closingRequested, saving, dirty, onClose]);
  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    try {
      const change: DatabaseRowSave = { values: changed };
      if (row) change.id = row.id;
      if (body !== (row?.body ?? "")) change.body = body;
      const saved = await onSubmit(change);
      if (saved) onClose();
      else {
        setConfirmClose(false);
        onKeepEditing();
        setError(
          "Couldn't save this row. Your changes are still here. Try again.",
        );
      }
    } catch {
      setConfirmClose(false);
      onKeepEditing();
      setError(
        "Couldn't save this row. Your changes are still here. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (confirmClose || (closingRequested && dirty) || navigationBlocked)
      return;
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <WorkspaceSidePanel>
      <ConversationAuxiliaryPanel
        sizing={sizing}
        onClose={close}
        className="mt-px mr-2 mb-2"
      >
        <div
          ref={panel}
          tabIndex={-1}
          role="region"
          aria-label="Row details"
          onKeyDown={onKeyDown}
          className="flex min-h-0 flex-1 flex-col outline-none"
        >
          <ConversationAuxiliaryPanelHeader
            title={row ? titleOf(database, row) || "Untitled" : "New record"}
            subtitle={database.name}
            onClose={close}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-5">
              {database.fields.map((field) => {
                const Icon = fieldIcon(field.type);
                const value = values[field.id];
                const text = cellAsText(value);
                return (
                  <div
                    key={field.id}
                    data-field={field.id}
                    tabIndex={-1}
                    className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30"
                  >
                    <label
                      htmlFor={`row-field-${field.id}`}
                      className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px]"
                    >
                      <Icon size={12} />
                      {field.name}
                    </label>
                    {field.type === "text" || field.type === "title" ? (
                      <textarea
                        id={`row-field-${field.id}`}
                        aria-label={field.name}
                        value={cellAsText(value) ?? ""}
                        rows={
                          field.type === "title"
                            ? 1
                            : Math.min(
                                10,
                                Math.max(
                                  2,
                                  Math.ceil(
                                    (cellAsText(value)?.length ?? 0) / 46,
                                  ),
                                ),
                              )
                        }
                        maxLength={field.type === "title" ? 200 : 2000}
                        placeholder="Empty"
                        className={`${bareFieldClass} resize-y text-[13px] leading-6`}
                        onChange={(event) =>
                          setValue(field.id, event.target.value || null)
                        }
                      />
                    ) : field.type === "url" || field.type === "number" ? (
                      <div className="flex items-start gap-2">
                        <input
                          id={`row-field-${field.id}`}
                          aria-label={field.name}
                          type={field.type === "number" ? "number" : "url"}
                          value={cellAsText(value) ?? cellAsNumber(value) ?? ""}
                          placeholder="Empty"
                          maxLength={2000}
                          className={`${bareFieldClass} text-[13px] leading-6`}
                          onChange={(event) =>
                            setValue(
                              field.id,
                              event.target.value === ""
                                ? null
                                : field.type === "number"
                                  ? Number(event.target.value)
                                  : event.target.value,
                            )
                          }
                        />
                        {field.type === "url" &&
                        text &&
                        /^https?:\/\//iu.test(text) ? (
                          <a
                            href={text}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label={`Open ${field.name}`}
                            className="text-muted-foreground hover:text-foreground mt-1"
                          >
                            <ArrowUpRight size={14} />
                          </a>
                        ) : null}
                      </div>
                    ) : (
                      <CellEditor
                        field={field}
                        value={value}
                        people={people}
                        className="hover:bg-foreground/[0.03] flex min-h-7 w-full items-center rounded-md py-1 text-left text-[13px]"
                        placeholder="Empty"
                        onChange={(next) => setValue(field.id, next)}
                      />
                    )}
                  </div>
                );
              })}
              <div className="border-foreground/[0.06] border-t pt-5">
                <p className="text-muted-foreground mb-2 text-[11px]">Notes</p>
                <DocumentEditor
                  compact
                  value={body}
                  onChange={setBody}
                  placeholder="Add notes…"
                />
              </div>
              {row?.source ? (
                <button
                  type="button"
                  onClick={() => onOpenSource(row)}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[12px]"
                >
                  {row.source.kind === "thread"
                    ? "Open thread"
                    : "Open automation"}
                  <ArrowUpRight size={12} />
                </button>
              ) : null}
            </div>
          </div>
          <footer className="border-foreground/[0.06] shrink-0 border-t px-5 py-3">
            {error ? (
              <p
                role="alert"
                className="text-destructive mb-3 text-[12px] leading-5"
              >
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              {row ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground -ml-2"
                  disabled={saving}
                  onClick={() => onRemove(row)}
                >
                  Delete
                </Button>
              ) : null}
              <span className="ml-auto" />
              <Button
                size="sm"
                disabled={!ready || saving}
                onClick={() => void submit()}
              >
                {saving ? "Saving…" : row ? "Save changes" : "Create"}
              </Button>
            </div>
          </footer>
        </div>
      </ConversationAuxiliaryPanel>
      <Dialog
        open={
          confirmClose ||
          Boolean(closingRequested && dirty && !saving) ||
          navigationBlocked
        }
        onOpenChange={(open) => {
          if (!open) keepEditing();
          else setConfirmClose(true);
        }}
      >
        <DialogContent
          className="w-[calc(100%-32px)] max-w-[360px] gap-0 overflow-hidden rounded-xl p-0 [&>button]:hidden"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DialogHeader className="border-border/60 border-b px-5 py-3.5">
            <DialogTitle className="text-sm">Unsaved changes</DialogTitle>
          </DialogHeader>
          <DialogDescription className="px-5 py-4 text-[13px] leading-5">
            You have unsaved changes. Are you sure you want to discard them?
          </DialogDescription>
          <DialogFooter className="border-border/60 bg-muted/10 border-t px-5 py-3">
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={keepEditing}
            >
              Keep editing
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={saving}
              onClick={discardChanges}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceSidePanel>
  );
}
