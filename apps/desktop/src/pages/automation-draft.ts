import { z } from "zod";

import type {
  automationOperators,
  AutomationStep,
  AutomationToolRef,
  WorkspaceSchedule,
  WorkspaceScheduleInput,
} from "@chief/relay-contracts";
import {
  agentIdSchema,
  automationIssueList,
  automationSchema,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  walkAutomation,
  workspaceScheduleInputSchema,
} from "@chief/relay-contracts";

import type { ScheduleFields } from "./schedule-editor";
import { cronFromFields, fieldsFromCron } from "./schedule-editor";

/** Everything the builder edits before it becomes a schedule input. */
export interface AutomationDraft {
  id: string;
  title: string;
  instructions: string;
  agentId: string;
  collaborators: string[];
  channelId: string;
  expectedOutcome: string;
  constraints: string;
  maxDurationMinutes: number;
  timezone: string;
  mode: "cron" | "once" | "webhook";
  fields: ScheduleFields;
  once: string;
  skipDates: string[];
  steps: AutomationStep[];
}

export type StepKind = AutomationStep["type"];

export const operatorLabels: Record<
  (typeof automationOperators)[number],
  string
> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  greater_than: "is more than",
  less_than: "is less than",
  is_empty: "is empty",
  is_not_empty: "has something",
};

function localDateTime(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function draftFromWork(
  work: WorkspaceSchedule | null,
  defaults: { agentId: string; channelId: string },
): AutomationDraft {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    id: work?.id ?? crypto.randomUUID(),
    title: work?.title ?? "",
    instructions: work?.instructions ?? "",
    agentId: work?.agentId ?? defaults.agentId,
    collaborators: work?.collaborators ?? [],
    channelId: work?.conversationId ?? defaults.channelId,
    expectedOutcome: work?.expectedOutcome ?? "",
    constraints: work?.constraints ?? "",
    maxDurationMinutes: work?.maxDurationMinutes ?? 60,
    timezone: work?.timezone ?? timezone,
    mode:
      work?.triggerMode === "webhook"
        ? "webhook"
        : work?.onceAt !== undefined
          ? "once"
          : "cron",
    fields: fieldsFromCron(work?.cron ?? "0 9 * * 1-5"),
    once: work?.onceAt ? localDateTime(work.onceAt) : "",
    skipDates: work?.skipDates ?? [],
    steps: work?.automation?.steps ?? [],
  };
}

/** The input the relay validates. Throws with a readable message when invalid. */
export function draftToInput(draft: AutomationDraft): WorkspaceScheduleInput {
  const onceAt =
    draft.mode === "once" ? new Date(draft.once).getTime() : undefined;
  if (
    onceAt !== undefined &&
    (!Number.isFinite(onceAt) || onceAt <= Date.now())
  )
    throw new Error("Choose a time in the future.");
  const firstLine = draft.instructions.trim().split(/\n/u)[0] ?? "";
  // With steps, the team is whoever takes them, as the relay also derives.
  const team = [
    ...new Set([
      draft.agentId,
      ...(draft.steps.length ? stepAgents(draft.steps) : draft.collaborators),
    ]),
  ];
  const parsed = workspaceScheduleInputSchema.safeParse({
    id: draft.id,
    title:
      draft.title.trim() || firstLine.slice(0, 100) || "Untitled automation",
    conversationId:
      draft.channelId === "new" ? `automation-${draft.id}` : draft.channelId,
    newChannel: draft.channelId === "new" ? {} : undefined,
    agentId: draft.agentId,
    collaborators: team.filter((id) => id !== draft.agentId),
    instructions:
      draft.instructions.trim() || draft.title.trim() || "Run the steps below.",
    expectedOutcome: draft.expectedOutcome,
    constraints: draft.constraints,
    maxDurationMinutes: draft.maxDurationMinutes,
    triggerMode: draft.mode === "webhook" ? "webhook" : "cron",
    onceAt,
    timezone: draft.timezone,
    cron: cronFromFields(draft.fields),
    approvalSummary: draft.expectedOutcome || draft.instructions,
    proposedToolPatterns: [],
    skipDates: draft.skipDates,
    automation: draft.steps.length
      ? { version: 1, steps: draft.steps }
      : undefined,
  });
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message ?? "This automation isn't complete yet.",
    );
  return parsed.data;
}

const fieldNames: Record<string, string> = {
  title: "a name",
  prompt: "instructions",
  value: "something to check",
  agentId: "an agent",
};

/** The first problem with each step, keyed by step id ("" for the whole automation). */
export function draftIssueMap(draft: AutomationDraft) {
  const issues = new Map<string, string>();
  if (!draft.steps.length) return issues;
  const parsed = automationSchema.safeParse({ version: 1, steps: draft.steps });
  for (const issue of parsed.success ? [] : parsed.error.issues) {
    if (issue.code === "custom") continue;
    let list: readonly AutomationStep[] = draft.steps;
    let step: AutomationStep | undefined;
    let field = "";
    for (let index = 1; index < issue.path.length; index += 1) {
      const segment = issue.path[index];
      if (isJsonNumber(segment)) {
        step = list[segment];
        continue;
      }
      if (
        step?.type === "condition" &&
        (segment === "then" || segment === "else")
      ) {
        list = step[segment];
        continue;
      }
      field = String(segment);
      break;
    }
    if (step && !issues.has(step.id))
      issues.set(
        step.id,
        `Add ${fieldNames[field] ?? field} to finish this step.`,
      );
  }
  for (const issue of automationIssueList({ steps: draft.steps }))
    if (!issues.has(issue.stepId ?? ""))
      issues.set(issue.stepId ?? "", issue.message);
  return issues;
}

export function findStep(steps: readonly AutomationStep[], id: string) {
  return [...walkAutomation(steps)].find(({ step }) => step.id === id)?.step;
}

/** Applies `change` to the list that holds `id` (or the root list). */
function editList(
  steps: AutomationStep[],
  listOwner: { parentId?: string; branch?: "then" | "else" },
  change: (list: AutomationStep[]) => AutomationStep[],
): AutomationStep[] {
  if (!listOwner.parentId) return change(steps);
  return steps.map((step) => {
    if (step.type !== "condition") return step;
    if (step.id === listOwner.parentId) {
      const branch = listOwner.branch ?? "then";
      return { ...step, [branch]: change(step[branch]) };
    }
    return {
      ...step,
      then: editList(step.then, listOwner, change),
      else: editList(step.else, listOwner, change),
    };
  });
}

export interface StepSlot {
  parentId?: string;
  branch?: "then" | "else";
  index: number;
}

export function insertStep(
  steps: AutomationStep[],
  slot: StepSlot,
  step: AutomationStep,
) {
  return editList(steps, slot, (list) => [
    ...list.slice(0, slot.index),
    step,
    ...list.slice(slot.index),
  ]);
}

export function updateStep(
  steps: AutomationStep[],
  id: string,
  update: (step: AutomationStep) => AutomationStep,
): AutomationStep[] {
  return steps.map((step) => {
    if (step.id === id) return update(step);
    if (step.type !== "condition") return step;
    return {
      ...step,
      then: updateStep(step.then, id, update),
      else: updateStep(step.else, id, update),
    };
  });
}

export function removeStep(
  steps: AutomationStep[],
  id: string,
): AutomationStep[] {
  return steps
    .filter((step) => step.id !== id)
    .map((step) =>
      step.type === "condition"
        ? {
            ...step,
            then: removeStep(step.then, id),
            else: removeStep(step.else, id),
          }
        : step,
    );
}

/** Reorders within the list that holds both steps. */
export function moveStep(
  steps: AutomationStep[],
  id: string,
  overId: string,
): AutomationStep[] {
  const index = steps.findIndex((step) => step.id === id);
  const over = steps.findIndex((step) => step.id === overId);
  if (index >= 0 && over >= 0) {
    const next = [...steps];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(over, 0, moved);
    return next;
  }
  return steps.map((step) =>
    step.type === "condition"
      ? {
          ...step,
          then: moveStep(step.then, id, overId),
          else: moveStep(step.else, id, overId),
        }
      : step,
  );
}

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 28) || "step"
  );
}

export function uniqueStepId(steps: readonly AutomationStep[], title: string) {
  // The builder uses these two names for the trigger and settings panels.
  const taken = new Set([
    "trigger",
    "settings",
    ...[...walkAutomation(steps)].map(({ step }) => step.id),
  ]);
  const base = slug(title);
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1)
    candidate = `${base}_${suffix}`;
  return candidate;
}

export function newStep(
  steps: readonly AutomationStep[],
  kind: StepKind,
  options: {
    agentId: string;
    agentName?: string;
    tool?: AutomationToolRef & { title?: string };
  },
): AutomationStep {
  if (kind === "agent") {
    const title = options.agentName ?? "Agent";
    return {
      id: uniqueStepId(steps, title),
      type: "agent",
      title,
      agentId: agentIdSchema.parse(options.agentId),
      prompt: "",
    };
  }
  if (kind === "tool" && options.tool) {
    const { title: toolTitle, ...tool } = options.tool;
    const title = toolTitle ?? tool.name;
    return {
      id: uniqueStepId(steps, title),
      type: "tool",
      title,
      tool,
      arguments: {},
    };
  }
  if (kind === "condition") {
    const title = "Check a condition";
    return {
      id: uniqueStepId(steps, title),
      type: "condition",
      title,
      when: { value: "", operator: "is_not_empty" },
      then: [],
      else: [],
    };
  }
  const title = "Stop here";
  return {
    id: uniqueStepId(steps, title),
    type: "stop",
    title,
    outcome: "skipped",
  };
}

/** The outputs a step may read: earlier siblings here and in every enclosing list. */
export function availableOutputs(steps: readonly AutomationStep[], id: string) {
  const visit = (
    list: readonly AutomationStep[],
    scope: AutomationStep[],
  ): AutomationStep[] | undefined => {
    const available = [...scope];
    for (const step of list) {
      if (step.id === id) return available;
      if (step.type === "condition") {
        const found =
          visit(step.then, available) ?? visit(step.else, available);
        if (found) return found;
      }
      if (step.type !== "stop") available.push(step);
    }
    return undefined;
  };
  return visit(steps, []) ?? [];
}

export function referenceFor(step: AutomationStep, path = "") {
  const suffix = path || (step.type === "agent" ? ".text" : "");
  return `{{steps.${step.id}.output${suffix}}}`;
}

/** Every agent that takes a step. */
export function stepAgents(steps: readonly AutomationStep[]) {
  return [...walkAutomation(steps)].flatMap(({ step }) =>
    step.type === "agent" ? [step.agentId] : [],
  );
}

/** Every tool the automation can use, as shown before approval. */
export function draftTools(steps: readonly AutomationStep[]) {
  return [...walkAutomation(steps)].flatMap(({ step }) =>
    step.type === "tool" ? [{ step, tool: step.tool }] : [],
  );
}

/**
 * Unsaved edits survive a reload of the app. Only this person's browser holds
 * them, kept per workspace, and they are dropped once saved or once the
 * automation changes.
 */
const storedDraftSchema = z.object({
  base: z.number().nullable(),
  draft: z.custom<AutomationDraft>(
    (value) =>
      isJsonObject(value) &&
      isJsonString(value.id) &&
      Array.isArray(value.steps),
  ),
});

function storedDraftKey(workspaceId: string, automationId: string) {
  return `chief:automation-draft:${workspaceId}:${automationId}`;
}

/** The unsaved draft for this automation, if it was made from `base`. */
export function readStoredDraft(
  workspaceId: string | undefined,
  automationId: string,
  base: number | null,
) {
  if (!workspaceId) return null;
  try {
    const raw = localStorage.getItem(storedDraftKey(workspaceId, automationId));
    const parsed = raw ? storedDraftSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success && parsed.data.base === base
      ? parsed.data.draft
      : null;
  } catch {
    return null;
  }
}

export function writeStoredDraft(
  workspaceId: string | undefined,
  automationId: string,
  base: number | null,
  draft: AutomationDraft | null,
) {
  if (!workspaceId) return;
  try {
    if (draft)
      localStorage.setItem(
        storedDraftKey(workspaceId, automationId),
        JSON.stringify({ base, draft }),
      );
    else localStorage.removeItem(storedDraftKey(workspaceId, automationId));
  } catch {
    /* Storage can be unavailable; the draft simply won't survive a reload. */
  }
}
