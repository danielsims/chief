import { useState } from "react";
import { Plus, X } from "lucide-react";

import type {
  DatabaseField,
  DatabaseFieldType,
  DatabaseOption,
} from "@chief/relay-contracts";
import { databaseColors, databaseLimits } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { cn } from "@chief/ui/lib/utils";

import { bareFieldClass, ColorDot } from "./database-cells";
import { colorName, fieldTypes, newKey } from "./database-model";

const rowClass =
  "flex h-8 items-center gap-2 rounded-lg px-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_9%,transparent)]";

/** Adds a field, or changes one: its name, its type and a select's options. */
export function DatabaseFieldDialog({
  field,
  typeLocked = false,
  onClose,
  onSubmit,
}: {
  field?: DatabaseField;
  /** Set when a view depends on the field's type, such as a board's group. */
  typeLocked?: boolean;
  onClose: () => void;
  onSubmit: (field: DatabaseField) => void;
}) {
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<DatabaseFieldType>(field?.type ?? "text");
  const [options, setOptions] = useState<DatabaseOption[]>(
    field?.type === "select" ? field.options : [],
  );
  const named = options.filter((option) => option.name.trim());
  const ready = Boolean(name.trim());
  const submit = () => {
    if (!ready) return;
    const base = { id: field?.id ?? newKey("field"), name: name.trim() };
    onSubmit(
      type === "select"
        ? {
            ...base,
            type,
            options: named.map((option) => ({
              ...option,
              name: option.name.trim(),
            })),
          }
        : { ...base, type },
    );
  };
  const change = (id: string, next: Partial<DatabaseOption>) =>
    setOptions((current) =>
      current.map((option) =>
        option.id === id ? { ...option, ...next } : option,
      ),
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="top-[22%] w-[calc(100%-32px)] max-w-[420px] translate-y-0 gap-0 overflow-hidden rounded-xl p-0"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      >
        <DialogTitle className="sr-only">
          {field ? "Edit field" : "New field"}
        </DialogTitle>
        <div className="space-y-4 px-5 pt-5 pb-4">
          <input
            autoFocus
            aria-label="Field name"
            value={name}
            maxLength={40}
            placeholder="Field name"
            className={cn(
              bareFieldClass,
              "text-[16px] leading-6 font-medium tracking-[-0.01em]",
            )}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && type !== "select") {
                event.preventDefault();
                submit();
              }
            }}
          />
          {field?.type !== "title" && !typeLocked ? (
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {fieldTypes.map((entry) => (
                <button
                  key={entry.type}
                  type="button"
                  role="radio"
                  aria-checked={type === entry.type}
                  onClick={() => setType(entry.type)}
                  className={cn(
                    "border-foreground/[0.09] text-foreground/80 hover:bg-foreground/[0.04] inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
                    type === entry.type &&
                      "border-foreground/30 bg-foreground/[0.05] text-foreground",
                  )}
                >
                  <entry.icon size={12} />
                  {entry.label}
                </button>
              ))}
            </div>
          ) : null}
          {type === "select" ? (
            <div className="space-y-1">
              {options.map((option) => (
                <div key={option.id} className={rowClass}>
                  <button
                    type="button"
                    title={`${colorName[option.color]}: change colour`}
                    aria-label={`Change ${option.name || "option"} colour`}
                    className="flex size-4 items-center justify-center"
                    onClick={() =>
                      change(option.id, {
                        color:
                          databaseColors[
                            (databaseColors.indexOf(option.color) + 1) %
                              databaseColors.length
                          ],
                      })
                    }
                  >
                    <ColorDot color={option.color} />
                  </button>
                  <input
                    aria-label="Option name"
                    value={option.name}
                    maxLength={40}
                    placeholder="Option"
                    className={cn(bareFieldClass, "text-[13px]")}
                    onChange={(event) =>
                      change(option.id, { name: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${option.name || "option"}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setOptions((current) =>
                        current.filter((other) => other.id !== option.id),
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {options.length < databaseLimits.options ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1.5 px-2.5 text-[12px] transition-colors"
                  onClick={() =>
                    setOptions((current) => [
                      ...current,
                      { id: newKey("option"), name: "", color: "gray" },
                    ])
                  }
                >
                  <Plus size={13} />
                  Add option
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <footer className="flex items-center gap-2 border-t border-black/[0.055] px-5 py-3 dark:border-white/[0.06]">
          <span className="text-muted-foreground ml-auto text-[11px]">⌘↵</span>
          <Button size="sm" disabled={!ready} onClick={submit}>
            {field ? "Save" : "Add field"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
