import type { KeyboardEvent, ReactNode } from "react";
import { Fragment, useRef, useState } from "react";
import { Check } from "lucide-react";

import type {
  DatabaseColor,
  DatabaseField,
  DatabaseValue,
} from "@chief/relay-contracts";
import { cellAsNumber, cellAsText } from "@chief/relay-contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { cn } from "@chief/ui/lib/utils";

import type { DatabasePersonOption } from "./database-model";
import { AgentAvatar } from "../agent-avatar";
import { UserAvatar } from "../user-avatar";
import { colorClass, personOf } from "./database-model";

export function ColorDot({
  color,
  className,
}: {
  color: DatabaseColor;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        colorClass[color],
        className,
      )}
    />
  );
}

export function PersonAvatar({ person }: { person: DatabasePersonOption }) {
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

/**
 * Text typed straight onto the page: no box, border or focus fill, so it
 * reads as the thing it is becoming.
 */
export const bareFieldClass =
  "block w-full min-w-0 resize-none border-0 bg-transparent p-0 shadow-none outline-none placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-0";

/** A field that commits on Enter or blur and backs out on Escape. */
export function InlineField({
  initial = "",
  placeholder,
  maxLength,
  type = "text",
  className,
  onCommit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  maxLength?: number;
  type?: "text" | "number" | "url";
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
    if (commit && trimmed !== initial) onCommit(trimmed);
    else onCancel();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      finish(false);
    }
  };
  return (
    <input
      autoFocus
      type={type}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      className={cn(bareFieldClass, className)}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  );
}

/** A cell's value as text, for fields typed into. */
function textOf(value: DatabaseValue | undefined) {
  return cellAsText(value) ?? cellAsNumber(value)?.toString() ?? "";
}

/** A cell's value, read only. */
export function CellValue({
  field,
  value,
  people,
  linked = true,
}: {
  field: DatabaseField;
  value: DatabaseValue | undefined;
  people: readonly DatabasePersonOption[];
  /** Off where the value sits inside another control, such as an editor. */
  linked?: boolean;
}) {
  if (value === undefined) return null;
  if (field.type === "select") {
    const option = field.options.find((candidate) => candidate.id === value);
    return option ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <ColorDot color={option.color} />
        <span className="truncate">{option.name}</span>
      </span>
    ) : null;
  }
  if (field.type === "person") {
    const person = personOf(people, value);
    return person ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <PersonAvatar person={person} />
        <span className="truncate">{person.name}</span>
      </span>
    ) : null;
  }
  if (field.type === "checkbox")
    return value ? <Check size={13} aria-label="Yes" /> : null;
  const text = cellAsText(value);
  if (field.type === "date" && text)
    return (
      <span className="truncate">
        {new Date(`${text}T00:00:00`).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </span>
    );
  if (field.type === "url" && text && linked)
    return (
      <a
        href={text}
        target="_blank"
        rel="noreferrer noopener"
        className="truncate text-sky-600 hover:underline dark:text-sky-400"
        onClick={(event) => event.stopPropagation()}
      >
        {text.replace(/^https?:\/\/(www\.)?/u, "")}
      </a>
    );
  return <span className="truncate">{textOf(value)}</span>;
}

function Menu({
  trigger,
  className,
  children,
}: {
  trigger: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={className}>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Edits one cell. `className` styles the trigger, so the same editor sits in
 * a table cell or a property pill; `placeholder` shows while it's empty.
 */
export function CellEditor({
  field,
  value,
  people,
  className,
  placeholder,
  onChange,
}: {
  field: DatabaseField;
  value: DatabaseValue | undefined;
  people: readonly DatabasePersonOption[];
  className: string;
  placeholder: ReactNode;
  onChange: (value: DatabaseValue | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const shown =
    value === undefined ? (
      <span className="text-muted-foreground/70 truncate">{placeholder}</span>
    ) : (
      <CellValue field={field} value={value} people={people} linked={false} />
    );

  if (field.type === "select")
    return (
      <Menu trigger={shown} className={className}>
        {field.options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => onChange(option.id)}
          >
            <ColorDot color={option.color} />
            {option.name}
          </DropdownMenuItem>
        ))}
        {value !== undefined ? (
          <>
            {field.options.length ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={() => onChange(null)}>
              Clear
            </DropdownMenuItem>
          </>
        ) : null}
      </Menu>
    );

  if (field.type === "person")
    return (
      <Menu trigger={shown} className={className}>
        {people.map((person, index) => (
          <Fragment key={`${person.kind}:${person.id}`}>
            {index > 0 && person.kind !== people[index - 1]?.kind ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem
              onSelect={() =>
                onChange(
                  person.kind === "user"
                    ? { kind: "user", id: person.id }
                    : { kind: "agent", id: person.id },
                )
              }
            >
              <PersonAvatar person={person} />
              {person.name}
            </DropdownMenuItem>
          </Fragment>
        ))}
        {value !== undefined ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(null)}>
              Unassign
            </DropdownMenuItem>
          </>
        ) : null}
      </Menu>
    );

  if (field.type === "checkbox")
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={value === true}
        aria-label={field.name}
        className={className}
        onClick={() => onChange(value !== true)}
      >
        <span
          className={cn(
            "flex size-3.5 items-center justify-center rounded-[4px] border transition-colors",
            value === true
              ? "border-foreground bg-foreground text-background"
              : "border-foreground/25",
          )}
        >
          {value === true ? <Check size={10} strokeWidth={3} /> : null}
        </span>
      </button>
    );

  if (field.type === "date")
    return (
      <label className={className}>
        <input
          type="date"
          aria-label={field.name}
          value={cellAsText(value) ?? ""}
          className={cn(
            bareFieldClass,
            "w-auto [color-scheme:light] dark:[color-scheme:dark]",
            value === undefined && "text-muted-foreground/70",
          )}
          onChange={(event) => onChange(event.target.value || null)}
        />
      </label>
    );

  return editing ? (
    <div className={className}>
      <InlineField
        initial={textOf(value)}
        placeholder={field.name}
        maxLength={field.type === "title" ? 200 : 2_000}
        type={
          field.type === "number"
            ? "number"
            : field.type === "url"
              ? "url"
              : "text"
        }
        onCommit={(text) => {
          setEditing(false);
          if (!text) onChange(null);
          else if (field.type !== "number") onChange(text);
          else if (Number.isFinite(Number(text))) onChange(Number(text));
        }}
        onCancel={() => setEditing(false)}
      />
    </div>
  ) : (
    <button
      type="button"
      className={className}
      onClick={() => setEditing(true)}
    >
      {shown}
    </button>
  );
}
