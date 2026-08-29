import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../input.js";

export const scheduledWorkTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cron"),
    expression: boundedText(120),
    timezone: boundedText(120),
  }),
  z.object({ type: z.literal("once"), at: z.number().finite() }),
  z.object({ type: z.literal("webhook") }),
  z.object({
    type: z.literal("channel_mention"),
    channelId: boundedText(160),
    memberId: optionalBoundedText(120),
  }),
  z.object({
    type: z.literal("channel_message"),
    channelId: boundedText(160),
    contains: optionalBoundedText(500),
    authorTypes: z.array(z.enum(["user", "agent"])).optional(),
  }),
  z.object({
    type: z.literal("reaction_added"),
    channelId: boundedText(160),
    emoji: optionalBoundedText(80),
  }),
]);
