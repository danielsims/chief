import { z } from "zod";

import { channelWorkstreamStatuses } from "@chief/channel-api";

import { boundedText, optionalBoundedText } from "../../input.js";

export const channelVersionInputSchema = z.object({
  expectedVersion: z.number().int().min(1).optional(),
});

export const channelMemberReferenceSchema = z.object({
  type: z.enum(["user", "agent"]),
  id: boundedText(120),
});

export const channelWorkstreamInputSchema = z.object({
  status: z.enum(channelWorkstreamStatuses).optional(),
  repository: optionalBoundedText(500),
  baseBranch: optionalBoundedText(160),
  branch: optionalBoundedText(160),
  pullRequestUrls: z
    .array(boundedText(1_000).pipe(z.string().url()))
    .max(20)
    .optional(),
});
