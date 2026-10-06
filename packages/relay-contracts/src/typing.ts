import { z } from "zod";

import { conversationIdSchema, userIdSchema } from "./identifiers";

/**
 * An ephemeral typing signal on the workspace socket. It is never stored or
 * replayed; `active: false` means the person sent or cleared their draft.
 */
export const conversationTypingEventSchema = z.object({
  type: z.literal("conversation.typing"),
  conversationId: conversationIdSchema,
  userId: userIdSchema,
  active: z.boolean(),
});

export type ConversationTypingEvent = z.infer<
  typeof conversationTypingEventSchema
>;
