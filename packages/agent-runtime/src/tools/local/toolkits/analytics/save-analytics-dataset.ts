import { z } from "zod";

import type { AnalyticsDataset } from "../../../../types.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

function text(maximum: number) {
  return z
    .string()
    .transform((input) => input.trim().slice(0, maximum))
    .pipe(z.string().min(1));
}

function optionalText(maximum: number) {
  return z
    .string()
    .optional()
    .transform((input) => {
      const value = input?.trim().slice(0, maximum);
      return value === "" ? undefined : value;
    });
}

const metricValueSchema = z.object({
  metric: text(120),
  value: z.number().finite(),
});

const datasetSchema = z
  .object({
    provider: text(160),
    sourceId: text(240),
    key: text(120),
    title: text(200),
    description: optionalText(2_000),
    metrics: z
      .array(
        z.object({
          key: text(120),
          label: text(160),
          format: z.enum(["number", "currency", "percent", "duration"]),
          unit: optionalText(40),
          currency: optionalText(8),
        }),
      )
      .min(1)
      .max(40),
    dimensions: z.array(z.object({ key: text(120), label: text(160) })).max(20),
    periods: z
      .array(
        z.object({
          key: text(120),
          label: text(160),
          startDate: text(40),
          endDate: text(40),
          values: z.array(metricValueSchema).max(40),
        }),
      )
      .max(24),
    rows: z
      .array(
        z.object({
          dimensions: z
            .array(
              z.object({
                dimension: text(120),
                value: z.string().transform((input) => input.slice(0, 500)),
              }),
            )
            .max(20),
          values: z.array(metricValueSchema).max(40),
        }),
      )
      .max(1_000)
      .optional(),
    series: z
      .array(
        z.object({
          id: text(120),
          label: text(200),
          metric: text(120),
          points: z
            .array(
              z.object({
                x: z.string().transform((input) => input.slice(0, 200)),
                value: z.number().finite(),
              }),
            )
            .max(5_000),
        }),
      )
      .max(12)
      .optional(),
    charts: z
      .array(
        z.object({
          kind: z.literal("line"),
          title: text(160),
          subtitle: optionalText(240),
          xLabel: optionalText(80),
          yLabel: text(80),
          series: z.array(text(120)).min(1).max(4),
        }),
      )
      .max(8)
      .optional(),
    provenance: z
      .object({
        operation: optionalText(240),
        query: z
          .array(
            z.object({
              key: text(120),
              value: z.string().transform((input) => input.slice(0, 1_000)),
            }),
          )
          .max(40)
          .optional(),
        notes: optionalText(2_000),
      })
      .optional(),
  })
  .superRefine((input, context) => {
    if (JSON.stringify(input).length > 1_500_000) {
      context.addIssue({ code: "custom", message: "Dataset is too large." });
    }
  });

export const saveAnalyticsDatasetTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/analytics/datasets",
  operation: {
    operationId: "analytics.saveDataset",
    summary: "Save a normalized analytics dataset",
    description:
      "Stores a bounded reusable analytics projection from a connected source.",
  },
  inputSchema: datasetSchema,
  async execute({ input, manager, workspaceId }) {
    const dataset = await manager.saveAnalyticsDataset(
      workspaceId,
      input satisfies Omit<AnalyticsDataset, "capturedAt">,
    );
    return jsonResponse({ dataset });
  },
});
