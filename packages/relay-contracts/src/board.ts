import { z } from "zod";

import { agentIdSchema, userIdSchema } from "./identifiers";

export const boardLaneColors = [
  "gray",
  "blue",
  "green",
  "amber",
  "red",
  "purple",
] as const;

/** A column on the board. People can rename, recolour, add and remove them. */
export const boardLaneSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/u),
  name: z.string().trim().min(1).max(40),
  color: z.enum(boardLaneColors).default("gray"),
});

/** Where a board starts. Needs you is anything waiting on a person. */
export const defaultBoardLanes: readonly BoardLane[] = [
  { id: "backlog", name: "Backlog", color: "gray" },
  { id: "needs_you", name: "Needs you", color: "amber" },
  { id: "waiting", name: "Waiting", color: "blue" },
  { id: "done", name: "Done", color: "green" },
];

export const maximumBoardLanes = 12;

export const boardLanesInputSchema = z
  .object({
    lanes: z.array(boardLaneSchema).min(1).max(maximumBoardLanes),
  })
  .strict()
  .refine(
    ({ lanes }) => new Set(lanes.map((lane) => lane.id)).size === lanes.length,
    "Each lane needs its own id.",
  );

/** The thread or automation a board item came from, to open it again. */
export const boardItemSourceSchema = z.discriminatedUnion("kind", [
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

/** Who an item is for: a person in the workspace, or an agent. */
export const boardAssigneeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: userIdSchema }).strict(),
  z.object({ kind: z.literal("agent"), id: agentIdSchema }).strict(),
]);

const boardItemFields = {
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2_000),
  lane: boardLaneSchema.shape.id,
  /** Order within a lane, lowest first. */
  position: z.number().finite(),
  assignee: boardAssigneeSchema,
  source: boardItemSourceSchema,
};

/**
 * Adds an item, or changes one when `id` names an existing item. Only the
 * fields sent change; `null` clears the assignee or source.
 */
export const boardItemSaveSchema = z
  .object({
    id: z.uuid().optional(),
    title: boardItemFields.title.optional(),
    notes: boardItemFields.notes.optional(),
    lane: boardItemFields.lane.optional(),
    position: boardItemFields.position.optional(),
    assignee: boardItemFields.assignee.nullable().optional(),
    source: boardItemFields.source.nullable().optional(),
  })
  .strict();

export const boardItemSchema = z.object({
  id: z.uuid(),
  title: boardItemFields.title,
  notes: boardItemFields.notes,
  lane: boardItemFields.lane,
  position: boardItemFields.position,
  assignee: boardItemFields.assignee.optional(),
  source: boardItemFields.source.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const boardSchema = z.object({
  lanes: z.array(boardLaneSchema),
  items: z.array(boardItemSchema),
});

export const boardItemDeleteResultSchema = z.object({ deleted: z.boolean() });

export type BoardLane = z.infer<typeof boardLaneSchema>;
export type BoardLaneColor = BoardLane["color"];
export type BoardItemSource = z.infer<typeof boardItemSourceSchema>;
export type BoardAssignee = z.infer<typeof boardAssigneeSchema>;
export type BoardItemSave = z.input<typeof boardItemSaveSchema>;
export type BoardItem = z.infer<typeof boardItemSchema>;
export type Board = z.infer<typeof boardSchema>;
