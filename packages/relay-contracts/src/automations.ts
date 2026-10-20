import { z } from "zod";

import type { JsonValue } from "./json";
import { agentIdSchema } from "./identifiers";
import {
  isJsonObject,
  isJsonString,
  jsonObjectSchema,
  jsonValueSchema,
} from "./json";
import { mcpConnectionIdSchema } from "./mcp-connections";

/**
 * An automation is the work a schedule does: an ordered list of steps that can
 * branch. Lists nest instead of using free edges, so every automation is a
 * readable top-to-bottom flow and can never loop.
 */
export const AUTOMATION_MAX_STEPS = 30;
export const AUTOMATION_MAX_DEPTH = 4;

export const automationStepIdSchema = z.string().regex(/^[a-z0-9_-]{1,40}$/u);

export const automationToolRefSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("chief"),
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9.]{0,127}$/u),
  }),
  z.object({
    source: z.literal("plugin"),
    connectionId: mcpConnectionIdSchema,
    name: z.string().min(1).max(128),
    /** What the tool was when the automation was saved; enforced on every run. */
    readOnly: z.boolean(),
  }),
]);

export const automationOperators = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
] as const;

export const automationRuleSchema = z.object({
  value: z.string().trim().min(1).max(300),
  operator: z.enum(automationOperators),
  compare: z.string().max(1_000).optional(),
});

const stepBase = {
  id: automationStepIdSchema,
  title: z.string().trim().min(1).max(120),
};

export type AutomationStep =
  | {
      id: string;
      type: "agent";
      title: string;
      agentId: z.infer<typeof agentIdSchema>;
      prompt: string;
    }
  | {
      id: string;
      type: "tool";
      title: string;
      tool: z.infer<typeof automationToolRefSchema>;
      arguments: z.infer<typeof jsonObjectSchema>;
    }
  | {
      id: string;
      type: "condition";
      title: string;
      when: z.infer<typeof automationRuleSchema>;
      then: AutomationStep[];
      else: AutomationStep[];
    }
  | {
      id: string;
      type: "stop";
      title: string;
      outcome: "completed" | "skipped";
    };

export const automationStepSchema: z.ZodType<AutomationStep> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      ...stepBase,
      type: z.literal("agent"),
      agentId: agentIdSchema,
      prompt: z.string().trim().min(1).max(8_000),
    }),
    z.object({
      ...stepBase,
      type: z.literal("tool"),
      tool: automationToolRefSchema,
      arguments: jsonObjectSchema.default({}),
    }),
    z.object({
      ...stepBase,
      type: z.literal("condition"),
      when: automationRuleSchema,
      then: z.array(automationStepSchema).max(AUTOMATION_MAX_STEPS),
      else: z.array(automationStepSchema).max(AUTOMATION_MAX_STEPS),
    }),
    z.object({
      ...stepBase,
      type: z.literal("stop"),
      outcome: z.enum(["completed", "skipped"]),
    }),
  ]),
);

export const automationSchema = z
  .object({
    version: z.literal(1),
    steps: z.array(automationStepSchema).min(1).max(AUTOMATION_MAX_STEPS),
  })
  .superRefine((automation, context) => {
    for (const issue of automationIssues(automation))
      context.addIssue({ code: "custom", message: issue });
  });

/** What happened to one step during a run. Outputs are bounded on write. */
export const automationNodeStateSchema = z.object({
  state: z.enum(["pending", "running", "completed", "failed", "skipped"]),
  /** What the step was given, with references resolved. */
  input: jsonValueSchema.optional(),
  output: jsonValueSchema.optional(),
  truncated: z.boolean().optional(),
  error: z.string().max(1_000).optional(),
  /** A write a test run only previewed: `output` is what it would send. */
  simulated: z.boolean().optional(),
  /** The agent hand-off behind an agent step. */
  runStepId: z.uuid().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
});

export const automationRunStateSchema = z.object({
  nodes: z.record(automationStepIdSchema, automationNodeStateSchema),
});

export type Automation = z.infer<typeof automationSchema>;
export type AutomationNodeState = z.infer<typeof automationNodeStateSchema>;
export type AutomationRunState = z.infer<typeof automationRunStateSchema>;
export type AutomationToolRef = z.infer<typeof automationToolRefSchema>;
export type AutomationRule = z.infer<typeof automationRuleSchema>;

/** `{{steps.<id>.output.a.0}}` or `{{trigger.input.a}}`. Nothing else. */
const templatePattern =
  /\{\{\s*(steps\.([a-z0-9_-]{1,40})\.output|trigger\.input)((?:\.[A-Za-z0-9_-]{1,64}){0,8})\s*\}\}/gu;
const anyTemplatePattern = /\{\{[\s\S]*?\}\}/gu;

export interface AutomationReference {
  raw: string;
  stepId?: string;
  path: string[];
}

/**
 * Replaces every reference in one pass, so text substituted for one reference
 * is never searched for the next, and `$` in values is taken literally.
 */
export function replaceAutomationReferences(
  text: string,
  replace: (reference: AutomationReference) => string,
): string {
  return text.replace(
    new RegExp(templatePattern.source, "gu"),
    (raw: string, _source: string, stepId: string | undefined, path: string) =>
      replace({ raw, stepId, path: path.split(".").filter(Boolean) }),
  );
}

export function automationReferences(text: string): AutomationReference[] {
  return [...text.matchAll(templatePattern)].map((match) => ({
    raw: match[0],
    stepId: match[2],
    path: (match[3] ?? "").split(".").filter(Boolean),
  }));
}

function stringsIn(value: JsonValue, out: string[] = []): string[] {
  if (isJsonString(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, out));
  else if (isJsonObject(value))
    Object.values(value).forEach((item) => stringsIn(item, out));
  return out;
}

/** Every text a step reads templates from. */
export function automationStepTexts(step: AutomationStep): string[] {
  if (step.type === "agent") return [step.prompt];
  if (step.type === "tool") return stringsIn(step.arguments);
  if (step.type === "condition")
    return [step.when.value, ...(step.when.compare ? [step.when.compare] : [])];
  return [];
}

/** Depth-first, in execution order. */
export function* walkAutomation(
  steps: readonly AutomationStep[],
  depth = 1,
): Generator<{ step: AutomationStep; depth: number }> {
  for (const step of steps) {
    yield { step, depth };
    if (step.type === "condition") {
      yield* walkAutomation(step.then, depth + 1);
      yield* walkAutomation(step.else, depth + 1);
    }
  }
}

export function automationToolRefs(automation: {
  steps: readonly AutomationStep[];
}): AutomationToolRef[] {
  return [...walkAutomation(automation.steps)].flatMap(({ step }) =>
    step.type === "tool" ? [step.tool] : [],
  );
}

export function automationAgents(automation: {
  steps: readonly AutomationStep[];
}): string[] {
  return [
    ...new Set(
      [...walkAutomation(automation.steps)].flatMap(({ step }) =>
        step.type === "agent" ? [step.agentId] : [],
      ),
    ),
  ];
}

/**
 * Structural rules the schema alone cannot express. A step may only read the
 * output of a step that is guaranteed to have run before it: an earlier
 * sibling in its own list or in any list that contains it.
 */
export function automationIssueList(automation: {
  steps: readonly AutomationStep[];
}): { stepId?: string; message: string }[] {
  const issues: { stepId?: string; message: string }[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const { step, depth } of walkAutomation(automation.steps)) {
    total += 1;
    if (depth > AUTOMATION_MAX_DEPTH)
      issues.push({
        stepId: step.id,
        message: `"${step.title}" is nested more than ${AUTOMATION_MAX_DEPTH} levels deep.`,
      });
    if (seen.has(step.id))
      issues.push({
        stepId: step.id,
        message: `Step id "${step.id}" is used twice.`,
      });
    seen.add(step.id);
  }
  if (total > AUTOMATION_MAX_STEPS)
    issues.push({
      message: `An automation can have at most ${AUTOMATION_MAX_STEPS} steps.`,
    });

  const visit = (steps: readonly AutomationStep[], available: Set<string>) => {
    const scope = new Set(available);
    steps.forEach((step, index) => {
      for (const text of automationStepTexts(step)) {
        const valid = new Set(automationReferences(text).map((ref) => ref.raw));
        for (const match of text.matchAll(anyTemplatePattern))
          if (!valid.has(match[0]))
            issues.push({
              stepId: step.id,
              message: `"${step.title}" has an unknown reference ${match[0]}.`,
            });
        for (const ref of automationReferences(text))
          if (ref.stepId !== undefined && !scope.has(ref.stepId))
            issues.push({
              stepId: step.id,
              message: `"${step.title}" uses ${ref.raw}, but that step has not run yet at this point.`,
            });
      }
      if (step.type === "stop" && index !== steps.length - 1)
        issues.push({
          stepId: step.id,
          message: `"${step.title}" ends the run, so nothing can follow it.`,
        });
      if (step.type === "condition") {
        visit(step.then, scope);
        visit(step.else, scope);
      }
      scope.add(step.id);
    });
  };
  visit(automation.steps, new Set());
  return issues;
}

export function automationIssues(automation: {
  steps: readonly AutomationStep[];
}): string[] {
  return automationIssueList(automation).map((issue) => issue.message);
}
