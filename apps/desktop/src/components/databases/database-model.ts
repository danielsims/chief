import type { LucideIcon } from "lucide-react";
import {
  AlignLeft,
  Calendar,
  CircleDot,
  Hash,
  Link,
  SquareCheck,
  Type,
  UserRound,
} from "lucide-react";

import type {
  Database,
  DatabaseColor,
  DatabaseField,
  DatabaseFieldType,
  DatabasePerson,
  DatabaseRow,
  DatabaseValue,
} from "@chief/relay-contracts";
import { cellAsPerson, cellAsText } from "@chief/relay-contracts";

export const colorClass: Record<DatabaseColor, string> = {
  gray: "bg-zinc-400",
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  purple: "bg-violet-500",
};

export const colorName: Record<DatabaseColor, string> = {
  gray: "Gray",
  blue: "Blue",
  green: "Green",
  amber: "Amber",
  red: "Red",
  purple: "Purple",
};

export const fieldTypes: readonly {
  type: Exclude<DatabaseFieldType, "title">;
  label: string;
  icon: LucideIcon;
}[] = [
  { type: "text", label: "Text", icon: AlignLeft },
  { type: "number", label: "Number", icon: Hash },
  { type: "select", label: "Select", icon: CircleDot },
  { type: "person", label: "Person", icon: UserRound },
  { type: "date", label: "Date", icon: Calendar },
  { type: "checkbox", label: "Checkbox", icon: SquareCheck },
  { type: "url", label: "Link", icon: Link },
];

export function fieldIcon(type: DatabaseFieldType) {
  return fieldTypes.find((entry) => entry.type === type)?.icon ?? Type;
}

/** Someone a person cell can hold: a person or an agent. */
export type DatabasePersonOption = DatabasePerson & {
  name: string;
  image?: string;
};

export function personOf(
  people: readonly DatabasePersonOption[],
  value: DatabaseValue | undefined,
) {
  const cell = cellAsPerson(value);
  return people.find(
    (person) => person.kind === cell?.kind && person.id === cell.id,
  );
}

/**
 * A board is a database people work as a board: its main view is one. It
 * lives on Boards; every other database is an artifact.
 */
export function isBoard(database: Database) {
  return database.views[0]?.layout === "board";
}

export function titleField(database: Database) {
  return database.fields[0];
}

export function titleOf(database: Database, row: DatabaseRow) {
  const value = row.values[titleField(database)?.id ?? ""];
  return cellAsText(value) ?? "";
}

/** The first field of a type, such as who a board card is assigned to. */
export function firstField(
  database: Database,
  type: DatabaseFieldType,
): DatabaseField | undefined {
  return database.fields.find((field) => field.type === type);
}

/** A short id for a new field, option or view. */
export function newKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Markdown as one line of plain text, for a preview. */
export function plainText(markdown: string) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^```.*$/gmu, "")
    .replace(/^\s{0,3}(?:#{1,6}\s|>\s?|[-*+]\s|\d+\.\s)/gmu, "")
    .replace(/[*_~`]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** A position between a row's new neighbours, so only it is saved. */
export function positionBetween(
  before: number | undefined,
  after: number | undefined,
) {
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + 1;
  if (after !== undefined) return after - 1;
  return 0;
}
