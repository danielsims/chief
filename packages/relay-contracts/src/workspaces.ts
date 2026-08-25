import { z } from "zod";

import {
  commandIdSchema,
  conversationIdSchema,
  isoDateTimeSchema,
  secretNameSchema,
  workspaceIdSchema,
} from "./identifiers";
import {
  principalSchema,
  userPrincipalSchema,
  workspaceRoleSchema,
} from "./identity";
import { relayProjectSchema } from "./projects";

export const claimWorkspaceCommandSchema = z
  .object({
    commandId: commandIdSchema,
    workspaceId: workspaceIdSchema,
    name: z.string().trim().min(1).max(120),
    bootstrapToken: z.string().min(32).max(512),
  })
  .strict();

export const claimedWorkspaceSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: z.string().min(1).max(120),
    createdAt: z.iso.datetime({ offset: true }),
    principal: userPrincipalSchema,
  })
  .strict();

export const workspaceAuthorizationResultSchema = z
  .object({ principal: principalSchema })
  .strict();

export const switchWorkspaceCommandSchema = z
  .object({ workspaceId: workspaceIdSchema })
  .strict();

export const workspaceSummarySchema = z
  .object({
    id: workspaceIdSchema,
    name: z.string().trim().min(1).max(120),
    website: z.string().trim().max(2_048).default(""),
    imageURL: z.url().nullable().default(null),
    isActive: z.boolean(),
    onboardingComplete: z.boolean(),
  })
  .strict();

export const workspaceListResultSchema = z
  .object({ workspaces: z.array(workspaceSummarySchema) })
  .strict();

export const workspaceSwitchResultSchema = z
  .object({ workspaceId: workspaceIdSchema, isActive: z.literal(true) })
  .strict();

export const workspaceSecretResultSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: secretNameSchema,
    value: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .strict();

export const workspaceSecretListEntrySchema = z
  .object({ name: secretNameSchema, updatedAt: isoDateTimeSchema })
  .strict();

export const workspaceSecretListResultSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    secrets: z.array(workspaceSecretListEntrySchema),
  })
  .strict();

export const organizationWorkspaceJoinResultSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    workspaceName: z.string().trim().min(1).max(120),
    website: z.string().trim().max(2_048).default(""),
  })
  .strict();

export const workspaceMemberKindSchema = z.enum(["user", "agent", "service"]);

export const workspaceMemberSchema = z
  .object({
    kind: workspaceMemberKindSchema,
    principalId: z.string().trim().min(1).max(256),
    role: workspaceRoleSchema,
  })
  .strict();

export const workspaceMemberListSchema = z
  .object({ members: z.array(workspaceMemberSchema).max(1_000) })
  .strict();

export const updateWorkspaceMemberRoleCommandSchema = z
  .object({ role: workspaceRoleSchema })
  .strict();

export const updateWorkspaceMemberRoleResultSchema = z
  .object({ member: workspaceMemberSchema })
  .strict();

export const workspaceDeleteResultSchema = z
  .object({ workspaceId: workspaceIdSchema, deleted: z.literal(true) })
  .strict();

const workspaceInviteSecretSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const createWorkspaceInviteCommandSchema = z
  .object({
    commandId: commandIdSchema,
    secret: workspaceInviteSecretSchema,
    conversationId: conversationIdSchema.nullable().default(null),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const workspaceInviteSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    workspaceName: z.string().trim().min(1).max(120),
    website: z.string().trim().max(2_048).default(""),
    conversationId: conversationIdSchema.nullable(),
    conversationName: z.string().trim().min(1).max(120).nullable(),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const claimWorkspaceInviteCommandSchema = z
  .object({
    commandId: commandIdSchema,
    secret: workspaceInviteSecretSchema,
  })
  .strict();

export const previewWorkspaceInviteCommandSchema = z
  .object({ secret: workspaceInviteSecretSchema })
  .strict();

export const workspaceInviteClaimResultSchema = workspaceInviteSchema
  .extend({
    alreadyMember: z.boolean(),
  })
  .strict();

export const createWorkspaceCommandSchema = z
  .object({
    commandId: commandIdSchema,
    name: z.string().trim().min(1).max(120),
    website: z.string().trim().max(2_048).default(""),
    runtime: z.enum(["phone", "desktop", "cloud"]),
    inferenceProvider: z.string().trim().min(1).max(64),
    inferenceModel: z.string().trim().min(1).max(128),
    selectedApps: z.array(z.string().trim().min(1).max(128)).max(100),
  })
  .strict();

export const conversationSummarySchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  kind: z.enum(["channel", "direct"]),
  isPrivate: z.boolean(),
  archived: z.boolean().default(false),
  unreadCount: z.int().nonnegative(),
  requiresAttention: z.boolean(),
  lastMessage: z.string().max(4_000).nullable(),
});

const agentSummarySchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  status: z.enum(["idle", "working", "needsYou", "offline"]),
});

export const workspaceSnapshotSchema = z
  .object({
    id: workspaceIdSchema,
    name: z.string().min(1).max(120),
    website: z.string().trim().max(2_048).default(""),
    selectedApps: z
      .array(z.string().trim().min(1).max(128))
      .max(100)
      .default([]),
    runtime: z.enum(["phone", "desktop", "cloud"]).nullable().default(null),
    imageURL: z.url().nullable(),
    onboardingComplete: z.boolean(),
    conversations: z.array(conversationSummarySchema),
    agents: z.array(agentSummarySchema),
    projects: z.array(relayProjectSchema),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export type ClaimWorkspaceCommand = z.infer<typeof claimWorkspaceCommandSchema>;
export type ClaimedWorkspace = z.infer<typeof claimedWorkspaceSchema>;
export type CreateWorkspaceCommand = z.infer<
  typeof createWorkspaceCommandSchema
>;
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export type SwitchWorkspaceCommand = z.infer<
  typeof switchWorkspaceCommandSchema
>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type OrganizationWorkspaceJoinResult = z.infer<
  typeof organizationWorkspaceJoinResultSchema
>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type CreateWorkspaceInviteCommand = z.infer<
  typeof createWorkspaceInviteCommandSchema
>;
export type WorkspaceInvite = z.infer<typeof workspaceInviteSchema>;
export type ClaimWorkspaceInviteCommand = z.infer<
  typeof claimWorkspaceInviteCommandSchema
>;
export type WorkspaceInviteClaimResult = z.infer<
  typeof workspaceInviteClaimResultSchema
>;
