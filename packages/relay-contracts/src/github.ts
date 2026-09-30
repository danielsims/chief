import { z } from "zod";

export const githubInstallationSchema = z.object({
  id: z.number().int().positive(),
  account: z.string().min(1),
  avatarUrl: z.string().url().optional(),
});

/**
 * Where a workspace's GitHub access comes from: the relay's own app (the
 * hosted relay ships one), an app a workspace owner created for a self-hosted
 * relay, or nothing yet.
 */
export const githubConnectionSchema = z.object({
  app: z.enum(["relay", "workspace"]).nullable(),
  appSlug: z.string().optional(),
  canManage: z.boolean(),
  installations: z.array(githubInstallationSchema),
});

export const githubRepositorySchema = z.object({
  id: z.number().int().positive(),
  fullName: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  private: z.boolean(),
  defaultBranch: z.string().min(1),
  cloneUrl: z.string().url(),
  updatedAt: z.string().optional(),
});

export const githubRepositoryListSchema = z.object({
  repositories: z.array(githubRepositorySchema),
});

export const githubAppSetupCommandSchema = z.object({
  name: z.string().trim().min(1).max(34),
});

export const githubBrowserUrlSchema = z.object({
  url: z.string().url(),
});

export const githubCloneTokenCommandSchema = z.object({
  repository: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/u),
});

export const githubCloneTokenSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string(),
});

export type GitHubInstallation = z.infer<typeof githubInstallationSchema>;
export type GitHubConnection = z.infer<typeof githubConnectionSchema>;
export type GitHubRepository = z.infer<typeof githubRepositorySchema>;
export type GitHubCloneToken = z.infer<typeof githubCloneTokenSchema>;
