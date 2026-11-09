import { z } from "zod";

import { agentIdSchema, userIdSchema } from "./identifiers";

/**
 * Who is connected right now, sent on the workspace socket. `userIds` are the
 * people with Chief open; `offlineAgentIds` are the device-hosted agents whose
 * device isn't connected; `erroredAgentIds` are agents whose last run failed.
 * Each event replaces the last one.
 */
export const workspacePresenceEventSchema = z.object({
  type: z.literal("workspace.presence"),
  userIds: z.array(userIdSchema),
  offlineAgentIds: z.array(agentIdSchema),
  erroredAgentIds: z.array(agentIdSchema),
});

export type WorkspacePresenceEvent = z.infer<
  typeof workspacePresenceEventSchema
>;

/** An agent's relay object telling its workspace about the agent's host. */
export const agentHostPresenceSchema = z.object({ online: z.boolean() });
