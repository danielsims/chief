import { z } from "zod";

import { commandEnvelopeSchema } from "./envelopes";
import { agentIdSchema, userIdSchema } from "./identifiers";
import { conversationSummarySchema } from "./workspaces";

export const directParticipantSchema = z
  .object({
    kind: z.enum(["user", "agent"]),
    principalId: z.union([userIdSchema, agentIdSchema]),
  })
  .strict();

export const directStartCommandSchema = commandEnvelopeSchema(
  z.object({ participant: directParticipantSchema }).strict(),
);

export const directStartResultSchema = z
  .object({ conversation: conversationSummarySchema })
  .strict();

export type DirectParticipant = z.infer<typeof directParticipantSchema>;
export type DirectStartCommand = z.infer<typeof directStartCommandSchema>;
export type DirectStartResult = z.infer<typeof directStartResultSchema>;
