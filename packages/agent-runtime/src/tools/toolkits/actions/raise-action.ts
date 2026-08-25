import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import type { InputRequest } from "../../../types.js";
import { assertSafeInputRequest } from "../../../input-values.js";
import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const stepSchema = z.object({
  text: boundedText(500),
  url: optionalBoundedText(1_000).refine(
    (url) =>
      url === undefined || /^https?:\/\//iu.test(url) || /^\/(?!\/)/u.test(url),
    "Action step URLs must use HTTP, HTTPS, or an absolute Chief app path.",
  ),
});

const questionOptionSchema = z.object({
  label: boundedText(120),
  description: optionalBoundedText(300),
  allowsFreeText: z.literal(true).optional(),
});

const questionSchema = z
  .object({
    question: boundedText(500),
    header: optionalBoundedText(80),
    multiSelect: z.boolean().default(false),
    allowFreeform: z.boolean().default(false),
    options: z.array(questionOptionSchema).max(8).default([]),
  })
  .superRefine((question, context) => {
    const count = question.options.filter(
      (option) => option.allowsFreeText,
    ).length;
    if (count > 1) {
      context.addIssue({
        code: "custom",
        message: "A question cannot have multiple free-text options.",
      });
    }
  })
  .transform((question) => ({
    ...question,
    options: [
      ...question.options.filter((option) => !option.allowsFreeText),
      ...question.options.filter((option) => option.allowsFreeText),
    ],
  }));

const environmentDestinationSchema = z.object({
  envKey: boundedText(120).refine(
    (key) => /^[A-Z][A-Z0-9_]{1,119}$/u.test(key),
    "Environment keys must use uppercase letters, numbers, and underscores.",
  ),
  file: z.never().optional(),
});

const fileDestinationSchema = z.object({
  file: boundedText(240),
  envKey: z.never().optional(),
});

const fieldSchema = z.object({
  key: boundedText(80),
  label: boundedText(160),
  type: z.enum(["text", "secret", "multiline"]).default("text"),
  save: z.union([environmentDestinationSchema, fileDestinationSchema]),
});

const requestSchema = z
  .object({
    steps: z.array(stepSchema).max(8).optional(),
    questions: z.array(questionSchema).max(6).optional(),
    fields: z.array(fieldSchema).max(8).default([]),
  })
  .superRefine((request, context) => {
    if ((request.questions?.length ?? 0) === 0 && request.fields.length === 0) {
      context.addIssue({
        code: "custom",
        message: "An action request needs at least one question or field.",
      });
    }
    const fieldKeys = request.fields.map((field) => field.key);
    if (new Set(fieldKeys).size !== fieldKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Action request field keys must be unique.",
      });
    }
  });

const actionInputSchema = z.object({
  agentId: optionalBoundedText(120),
  sourceId: optionalBoundedText(160),
  dedupeKey: optionalBoundedText(120),
  threadRootId: optionalBoundedText(160),
  title: boundedText(200),
  reason: boundedText(1_000).pipe(z.string().min(20)),
  request: requestSchema.optional(),
});

function structuredRequest(
  input: z.output<typeof requestSchema> | undefined,
  id: string,
  title: string,
  reason: string,
): InputRequest | undefined {
  if (!input) return undefined;
  const request: InputRequest = { id, title, reason, ...input };
  assertSafeInputRequest(request);
  return request;
}

export const raiseActionTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/action",
  operation: {
    operationId: "action.raise",
    summary: "Create an action that genuinely requires the user",
    description:
      "Use only for work the user must personally decide or perform. Recording an action never completes the current task.",
  },
  inputSchema: actionInputSchema,
  async execute({ input, manager, workspaceId }) {
    const dedupeKey =
      input.dedupeKey ?? input.title.toLowerCase().replaceAll(/\s+/gu, "-");
    const id = input.sourceId
      ? `action-${createHash("sha256")
          .update(`${workspaceId}\0${input.sourceId}\0${dedupeKey}`)
          .digest("hex")
          .slice(0, 32)}`
      : randomUUID();
    const existingAction = await manager.actionItem(workspaceId, id);
    if (existingAction && existingAction.title !== input.title) {
      throw new Error(
        `Action dedupeKey collision: ${dedupeKey} already belongs to "${existingAction.title}".`,
      );
    }
    const item = {
      id,
      agentId: input.agentId ?? "chief",
      title: input.title,
      reason: input.reason,
      sourceId: input.sourceId,
      threadRootId: input.threadRootId,
      request: structuredRequest(
        input.request,
        `${id}-request`,
        input.title,
        input.reason,
      ),
      status: "open" as const,
      createdAt: Date.now(),
    };
    await manager.raiseActionItem(workspaceId, item);
    return jsonResponse({
      actionItem: item,
      instruction:
        "Action recorded. Continue every independent part of the current task and do not raise an equivalent action again.",
    });
  },
});
