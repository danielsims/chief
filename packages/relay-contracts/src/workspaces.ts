import { z } from "zod";

import {
  commandIdSchema,
  isoDateTimeSchema,
  workspaceIdSchema,
} from "./identifiers";
import { principalSchema, userPrincipalSchema } from "./identity";

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

export const createWorkspaceCommandSchema = z
  .object({
    commandId: commandIdSchema,
    name: z.string().trim().min(1).max(120),
    website: z.string().trim().max(2_048).default(""),
    runtime: z.enum(["phone", "mac", "cloud"]),
    inferenceProvider: z.string().trim().min(1).max(64),
    inferenceModel: z.string().trim().min(1).max(128),
    selectedApps: z.array(z.string().trim().min(1).max(128)).max(100),
  })
  .strict();

const conversationSummarySchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  kind: z.enum(["channel", "direct"]),
  isPrivate: z.boolean(),
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
    imageURL: z.url().nullable(),
    onboardingComplete: z.boolean(),
    conversations: z.array(conversationSummarySchema),
    agents: z.array(agentSummarySchema),
    projects: z.array(
      z.object({
        id: z.string().min(1).max(128),
        name: z.string().min(1).max(120),
        repository: z.string().max(2_048),
        branch: z.string().max(512),
        changedFiles: z.int().nonnegative(),
      }),
    ),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export type ClaimWorkspaceCommand = z.infer<typeof claimWorkspaceCommandSchema>;
export type ClaimedWorkspace = z.infer<typeof claimedWorkspaceSchema>;
export type CreateWorkspaceCommand = z.infer<
  typeof createWorkspaceCommandSchema
>;
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
