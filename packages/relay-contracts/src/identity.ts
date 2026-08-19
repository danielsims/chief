import { z } from "zod";

import { agentIdSchema, userIdSchema, workspaceIdSchema } from "./identifiers";

export const authenticatedUserIdentitySchema = z
  .object({
    kind: z.literal("user"),
    userId: userIdSchema,
  })
  .strict();

export const authenticatedAgentIdentitySchema = z
  .object({
    kind: z.literal("agent"),
    agentId: agentIdSchema,
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

export const userPrincipalSchema = z.object({
  kind: z.literal("user"),
  userId: userIdSchema,
  workspaceId: workspaceIdSchema,
  role: workspaceRoleSchema,
});

export const agentPrincipalSchema = z.object({
  kind: z.literal("agent"),
  agentId: agentIdSchema,
  workspaceId: workspaceIdSchema,
});

export const servicePrincipalSchema = z.object({
  kind: z.literal("service"),
  service: z.string().trim().min(1).max(64),
  workspaceId: workspaceIdSchema.optional(),
});

export const principalSchema = z.discriminatedUnion("kind", [
  userPrincipalSchema,
  agentPrincipalSchema,
  servicePrincipalSchema,
]);

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type AuthenticatedIdentity = z.infer<typeof authenticatedIdentitySchema>;
export type UserPrincipal = z.infer<typeof userPrincipalSchema>;
export type AgentPrincipal = z.infer<typeof agentPrincipalSchema>;
export type ServicePrincipal = z.infer<typeof servicePrincipalSchema>;
export type Principal = z.infer<typeof principalSchema>;
