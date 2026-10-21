import { z } from "zod";

import { agentIdSchema } from "./identifiers";

/**
 * A member's desktop can lend a workspace's agents its internet connection.
 * It holds a socket open to the workspace and fetches public pages on request
 * from its own, usually residential, IP. These are the messages on that socket.
 */

/** The most page text a machine sends back, inside one socket message. */
export const webMachineBodyLimit = 700_000;

export const webMachineFetchRequestSchema = z.object({
  type: z.literal("web.fetch"),
  requestId: z.uuid(),
  url: z.url(),
  /** Who's asking, so the machine's owner can see who uses it. */
  agentId: agentIdSchema,
  requesterUserId: z.string().min(1).max(128).optional(),
});
export type WebMachineFetchRequest = z.infer<
  typeof webMachineFetchRequestSchema
>;

export const webMachineFetchResultSchema = z.union([
  z.object({
    type: z.literal("web.fetch.result"),
    requestId: z.uuid(),
    ok: z.literal(true),
    status: z.number().int(),
    url: z.url(),
    contentType: z.string().max(200),
    body: z.string().max(webMachineBodyLimit),
  }),
  z.object({
    type: z.literal("web.fetch.result"),
    requestId: z.uuid(),
    ok: z.literal(false),
    error: z.string().max(500),
  }),
]);
export type WebMachineFetchResult = z.infer<typeof webMachineFetchResultSchema>;

/** One person a machine is lent to: all the agents they own, or some. */
export const webMachineGrantSchema = z.object({
  userId: z.string().min(1).max(128),
  agentIds: z.union([z.literal("all"), z.array(agentIdSchema).max(100)]),
});
export type WebMachineGrant = z.infer<typeof webMachineGrantSchema>;

/**
 * Who may draw on a machine: only its owner's agents, everyone in the
 * workspace, or the agents of selected people. The owner's own agents are
 * always admitted, and a machine that hasn't said yet serves only them.
 */
export const webMachinePolicySchema = z.discriminatedUnion("allow", [
  z.object({ allow: z.literal("mine") }),
  z.object({ allow: z.literal("workspace") }),
  z.object({
    allow: z.literal("selected"),
    grants: z.array(webMachineGrantSchema).max(100),
  }),
]);
export type WebMachinePolicy = z.infer<typeof webMachinePolicySchema>;

/** Most fetches a machine serves a workspace per minute and per hour. */
export const webMachineRateLimits = { perMinute: 30, perHour: 600 } as const;

export const webMachinePolicyMessageSchema = z.object({
  type: z.literal("web.machine.policy"),
  policy: webMachinePolicySchema,
});

/** A one-time code a headless machine pairs with. */
export const machinePairingSchema = z.object({
  code: z.string(),
  expiresInSeconds: z.number(),
});

/** A machine paired to a workspace with its own key. */
export const pairedMachineSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  online: z.boolean(),
});
export type PairedMachine = z.infer<typeof pairedMachineSchema>;

export const pairedMachinesSchema = z.object({
  machines: z.array(pairedMachineSchema),
});

export const machineClaimSchema = z.object({
  machineId: z.uuid(),
  key: z.string(),
});

export const pairedMachineRemovedSchema = z.object({ ok: z.literal(true) });
