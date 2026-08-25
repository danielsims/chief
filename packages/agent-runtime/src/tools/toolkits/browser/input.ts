import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../input.js";

export const browserLabelsSchema = z
  .object({
    ref: optionalBoundedText(32),
    labels: z.array(boundedText(160)).min(1).max(8).optional(),
  })
  .refine((input) => Boolean(input.ref) || Boolean(input.labels?.length), {
    message: "ref or labels are required.",
  });

export function commandLabels(input: { ref?: string; labels?: string[] }) {
  return [
    ...(input.ref ? [input.ref.replace(/^@?/u, "@")] : []),
    ...(input.labels ?? []),
  ];
}
