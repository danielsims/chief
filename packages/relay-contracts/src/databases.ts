import { z } from "zod";

import { agentIdSchema, userIdSchema } from "./identifiers";

/**
 * What a workspace may hold. Every workspace gets these until plans exist;
 * the relay enforces them in one place.
 */
export const databaseLimits = {
  databases: 100,
  rows: 1_000,
  fields: 24,
  options: 24,
  views: 8,
} as const;

export type DatabaseLimits = { [Key in keyof typeof databaseLimits]: number };

/** The board every workspace starts with, in #general. */
export const workspaceBoardId = "workspace-board";

export const databaseColors = [
  "gray",
  "blue",
  "green",
  "amber",
  "red",
  "purple",
] as const;

const keySchema = z.string().regex(/^[a-z0-9_-]{1,40}$/u);
const nameSchema = z.string().trim().min(1).max(40);

export const databaseIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/u);

export const databaseOptionSchema = z
  .object({
    id: keySchema,
    name: nameSchema,
    color: z.enum(databaseColors).default("gray"),
  })
  .strict();

/** A column. Every database has exactly one title field, first. */
export const databaseFieldSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: keySchema,
      name: nameSchema,
      type: z.enum([
        "title",
        "text",
        "number",
        "person",
        "date",
        "checkbox",
        "url",
      ]),
    })
    .strict(),
  z
    .object({
      id: keySchema,
      name: nameSchema,
      type: z.literal("select"),
      options: z.array(databaseOptionSchema).max(databaseLimits.options),
    })
    .strict(),
]);

export const databaseViewSchema = z
  .object({
    id: keySchema,
    name: nameSchema,
    layout: z.enum(["table", "board"]),
    /** The select field a board groups by. */
    groupBy: keySchema.optional(),
  })
  .strict();

export const databasePersonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: userIdSchema }).strict(),
  z.object({ kind: z.literal("agent"), id: agentIdSchema }).strict(),
]);

/** A cell. Its shape follows the field: text, number, yes/no or a person. */
export const databaseValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  databasePersonSchema,
]);

const cellText = z.string();
const cellNumber = z.number();
const cellFlag = z.boolean();

/** A cell read as text, or undefined when it holds something else. */
export function cellAsText(value: DatabaseValue | undefined) {
  return cellText.safeParse(value).data;
}

/** A cell read as a number, or undefined when it holds something else. */
export function cellAsNumber(value: DatabaseValue | undefined) {
  return cellNumber.safeParse(value).data;
}

/** A cell read as yes or no, or undefined when it holds something else. */
export function cellAsFlag(value: DatabaseValue | undefined) {
  return cellFlag.safeParse(value).data;
}

/** A cell read as a person or agent, or undefined when it holds something else. */
export function cellAsPerson(value: DatabaseValue | undefined) {
  return databasePersonSchema.safeParse(value).data;
}

/** The thread or automation a row came from, to open it again. */
export const databaseRowSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("thread"),
      conversationId: z.string().min(1).max(160),
      threadRootId: z.string().min(1).max(160).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("automation"),
      scheduleId: z.string().min(1).max(120),
    })
    .strict(),
]);

const databaseParts = {
  name: z.string().trim().min(1).max(80),
  fields: z.array(databaseFieldSchema).min(1).max(databaseLimits.fields),
  views: z.array(databaseViewSchema).min(1).max(databaseLimits.views),
};

const channelsSchema = z.array(z.string().min(1).max(160)).max(24);

export const databaseSchema = z.object({
  id: databaseIdSchema,
  /** The channels it shows in. It is workspace data wherever it shows. */
  channels: channelsSchema.default([]),
  ...databaseParts,
  createdAt: z.number(),
  updatedAt: z.number(),
});

/**
 * Creates a database, or changes one when `id` names it. Only the parts sent
 * change; `channels` replaces the channels it shows in.
 */
export const databaseSaveSchema = z
  .object({
    id: databaseIdSchema.optional(),
    channels: channelsSchema.optional(),
    name: databaseParts.name.optional(),
    fields: databaseParts.fields.optional(),
    views: databaseParts.views.optional(),
  })
  .strict();

export const databaseRowSchema = z.object({
  id: z.uuid(),
  /** Cells by field id; an empty cell is left out. */
  values: z.record(keySchema, databaseValueSchema),
  /** The row's page, in Markdown. */
  body: z.string().max(20_000),
  /** Order within the database, lowest first. */
  position: z.number().finite(),
  source: databaseRowSourceSchema.optional(),
  /** Who first added the row, stamped by the relay. */
  createdBy: databasePersonSchema.optional(),
  /** Who last changed the row, stamped by the relay. */
  updatedBy: databasePersonSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/**
 * Adds a row, or changes one when `id` names it. Cells may be keyed by field
 * id or name, and a select by option id or name; `null` empties a cell.
 */
export const databaseRowSaveSchema = z
  .object({
    id: z.uuid().optional(),
    values: z
      .record(z.string().min(1).max(40), databaseValueSchema.nullable())
      .optional(),
    body: databaseRowSchema.shape.body.optional(),
    position: databaseRowSchema.shape.position.optional(),
    source: databaseRowSourceSchema.nullable().optional(),
    /**
     * Cells an existing row must match, keyed by field id or name. When one
     * matches and no id is given, that row is updated instead of adding a
     * duplicate.
     */
    match: z.record(z.string().min(1).max(40), databaseValueSchema).optional(),
  })
  .strict();

export const databaseListSchema = z.object({
  databases: z.array(databaseSchema),
});

export const databaseWithRowsSchema = z.object({
  database: databaseSchema,
  rows: z.array(databaseRowSchema),
});

export const databaseDeleteResultSchema = z.object({ deleted: z.boolean() });

export type DatabaseColor = (typeof databaseColors)[number];
export type DatabaseOption = z.infer<typeof databaseOptionSchema>;
export type DatabaseField = z.infer<typeof databaseFieldSchema>;
export type DatabaseFieldType = DatabaseField["type"];
export type DatabaseView = z.infer<typeof databaseViewSchema>;
export type DatabasePerson = z.infer<typeof databasePersonSchema>;
export type DatabaseValue = z.infer<typeof databaseValueSchema>;
export type DatabaseRowSource = z.infer<typeof databaseRowSourceSchema>;
export type Database = z.infer<typeof databaseSchema>;
export type DatabaseSave = z.input<typeof databaseSaveSchema>;
export type DatabaseRow = z.infer<typeof databaseRowSchema>;
export type DatabaseRowSave = z.input<typeof databaseRowSaveSchema>;
export type DatabaseWithRows = z.infer<typeof databaseWithRowsSchema>;

/** Where a board starts: a title, a status to group by and an assignee. */
export function boardTemplate(): Pick<Database, "fields" | "views"> {
  return {
    fields: [
      { id: "title", name: "Title", type: "title" },
      {
        id: "status",
        name: "Status",
        type: "select",
        options: [
          { id: "backlog", name: "Backlog", color: "gray" },
          { id: "needs_you", name: "Needs you", color: "amber" },
          { id: "waiting", name: "Waiting", color: "blue" },
          { id: "done", name: "Done", color: "green" },
        ],
      },
      { id: "assignee", name: "Assignee", type: "person" },
    ],
    views: [
      { id: "board", name: "Board", layout: "board", groupBy: "status" },
      { id: "table", name: "Table", layout: "table" },
    ],
  };
}
