import { z } from "zod";

import type { AgentInferenceTool } from "@chief/agent-computer";
import type { JsonValue } from "@chief/relay-contracts";

import type { DurablePlan, DurableTurn } from "./types.js";
import { durablePlanSchema } from "./types.js";

const setInputSchema = z.object({
  tasks: z
    .object({
      text: z.string().min(1).max(500),
      status: z.enum(["pending", "in_progress", "completed"]).optional(),
    })
    .array()
    .max(100),
});
const addInputSchema = z.object({ text: z.string().min(1).max(500) });
const updateInputSchema = z.object({
  id: z.number().int().positive(),
  text: z.string().min(1).max(500).optional(),
  status: z.enum(["pending", "in_progress", "completed"]).optional(),
  evidenceCallId: z.string().min(1).optional(),
});
const listInputSchema = z.object({});

export const durableTodoTools: readonly AgentInferenceTool[] = [
  {
    name: "todo_set",
    description:
      "Replace the durable task plan when starting or materially revising multi-step work.",
    parameters: {
      type: "object",
      required: ["tasks"],
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            required: ["text"],
            properties: {
              text: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
              },
            },
          },
        },
      },
    },
  },
  {
    name: "todo_add",
    description: "Append one item to the durable task plan.",
    parameters: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string" } },
    },
  },
  {
    name: "todo_update",
    description:
      "Update one durable task. When completing tool-backed work, cite its completed tool call id as evidenceCallId.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", minimum: 1 },
        text: { type: "string" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed"],
        },
        evidenceCallId: { type: "string" },
      },
    },
  },
  {
    name: "todo_list",
    description: "Read the authoritative durable task plan.",
    parameters: { type: "object", properties: {} },
  },
];

export function isTodoTool(name: string) {
  return durableTodoTools.some((tool) => tool.name === name);
}

export function executeTodo(
  turn: DurableTurn,
  name: string,
  rawInput: string | object,
): { plan: DurablePlan; result: JsonValue } {
  const input = parseInput(rawInput);
  if (name === "todo_list") {
    listInputSchema.parse(input);
    return { plan: turn.plan, result: turn.plan };
  }
  if (name === "todo_set") {
    const parsed = setInputSchema.parse(input);
    return result({
      revision: turn.plan.revision + 1,
      tasks: parsed.tasks.map((task, index) => ({
        id: index + 1,
        text: task.text,
        status: task.status ?? "pending",
        ...(task.status === "completed"
          ? { evidence: latestEvidence(turn) }
          : undefined),
      })),
    });
  }
  if (name === "todo_add") {
    const parsed = addInputSchema.parse(input);
    const nextId = Math.max(0, ...turn.plan.tasks.map((task) => task.id)) + 1;
    return result({
      revision: turn.plan.revision + 1,
      tasks: [
        ...turn.plan.tasks,
        { id: nextId, text: parsed.text, status: "pending" },
      ],
    });
  }
  if (name === "todo_update") {
    const parsed = updateInputSchema.parse(input);
    if (!turn.plan.tasks.some((task) => task.id === parsed.id)) {
      throw new Error(`Unknown durable task: ${parsed.id}`);
    }
    const cited = parsed.evidenceCallId
      ? turn.tools.find(
          (tool) =>
            tool.call.id === parsed.evidenceCallId &&
            tool.state === "completed",
        )
      : undefined;
    if (parsed.evidenceCallId && !cited) {
      throw new Error(
        `Task evidence ${parsed.evidenceCallId} is not a completed tool call.`,
      );
    }
    return result({
      revision: turn.plan.revision + 1,
      tasks: turn.plan.tasks.map((task) => {
        if (task.id !== parsed.id) return task;
        const status = parsed.status ?? task.status;
        return {
          id: task.id,
          text: parsed.text ?? task.text,
          status,
          ...(status === "completed"
            ? { evidence: parsed.evidenceCallId ?? latestEvidence(turn) }
            : undefined),
        };
      }),
    });
  }
  throw new Error(`Unknown durable todo tool: ${name}`);
}

export function hasOpenTasks(plan: DurablePlan) {
  return plan.tasks.some((task) => task.status !== "completed");
}

export function completionReminder(plan: DurablePlan) {
  const open = plan.tasks.filter((task) => task.status !== "completed");
  return `You attempted to finish with open durable tasks:\n${open
    .map((task) => `- #${task.id} [${task.status}] ${task.text}`)
    .join(
      "\n",
    )}\nContinue the work and update the plan as evidence is produced.`;
}

function result(plan: DurablePlan) {
  const parsed = durablePlanSchema.parse(plan);
  return { plan: parsed, result: parsed };
}

function latestEvidence(turn: DurableTurn) {
  for (let index = turn.tools.length - 1; index >= 0; index -= 1) {
    const tool = turn.tools[index];
    if (tool?.state === "completed") return tool.call.id;
  }
  return `model:${turn.messages.length}`;
}

function parseInput(input: string | object) {
  const text = z.string().safeParse(input);
  if (!text.success) return input;
  const parsed: unknown = JSON.parse(text.data);
  return parsed;
}
