import { z } from "zod";

import {
  agentIdSchema,
  conversationIdSchema,
  guestIdSchema,
  hexPubkeySchema,
  userIdSchema,
  workspaceIdSchema,
} from "./identifiers";

export const authenticatedUserIdentitySchema = z
  .object({
    kind: z.literal("user"),
    userId: userIdSchema,
    pubkey: hexPubkeySchema,
  })
  .strict();

export const authenticatedAgentIdentitySchema = z
  .object({
    kind: z.literal("agent"),
    agentId: agentIdSchema,
    pubkey: hexPubkeySchema,
  })
  .strict();

export const authenticatedServiceIdentitySchema = z
  .object({
    kind: z.literal("service"),
    service: z.string().trim().min(1).max(64),
  })
  .strict();

export const authenticatedIdentitySchema = z.discriminatedUnion("kind", [
  authenticatedUserIdentitySchema,
  authenticatedAgentIdentitySchema,
  authenticatedServiceIdentitySchema,
]);

export const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);

export const registerAgentKeyCommandSchema = z
  .object({
    agentId: agentIdSchema,
    pubkey: hexPubkeySchema,
  })
  .strict();

export const registerAgentKeyResultSchema = registerAgentKeyCommandSchema;

export type RegisterAgentKeyResult = z.infer<
  typeof registerAgentKeyResultSchema
>;

export const userPrincipalSchema = z.object({
  kind: z.literal("user"),
  userId: userIdSchema,
  pubkey: hexPubkeySchema,
  workspaceId: workspaceIdSchema,
  role: workspaceRoleSchema,
});

export const agentPrincipalSchema = z.object({
  kind: z.literal("agent"),
  agentId: agentIdSchema,
  pubkey: hexPubkeySchema,
  workspaceId: workspaceIdSchema,
  role: workspaceRoleSchema,
});

export const servicePrincipalSchema = z.object({
  kind: z.literal("service"),
  service: z.string().trim().min(1).max(64),
  workspaceId: workspaceIdSchema.optional(),
});

/** Never derived from a signed relay identity. Only the channel guest service
 * mints it, after verifying a guest credential, and it is scoped to exactly
 * one channel. */
export const guestPrincipalSchema = z.object({
  kind: z.literal("guest"),
  guestId: guestIdSchema,
  name: z.string().trim().min(1).max(80),
  image: z.url().max(2_048).optional(),
  workspaceId: workspaceIdSchema,
  conversationId: conversationIdSchema,
});

export const principalSchema = z.discriminatedUnion("kind", [
  userPrincipalSchema,
  agentPrincipalSchema,
  servicePrincipalSchema,
  guestPrincipalSchema,
]);

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type AuthenticatedIdentity = z.infer<typeof authenticatedIdentitySchema>;
export type UserPrincipal = z.infer<typeof userPrincipalSchema>;
export type AgentPrincipal = z.infer<typeof agentPrincipalSchema>;
export type ServicePrincipal = z.infer<typeof servicePrincipalSchema>;
export type GuestPrincipal = z.infer<typeof guestPrincipalSchema>;
export type Principal = z.infer<typeof principalSchema>;
