import { z } from "zod";

import { isoDateTimeSchema, workspaceIdSchema } from "./identifiers";

export const projectRepositoryKindSchema = z.enum(["attached", "cloned"]);
export const projectProviderIdSchema = z.enum([
  "local",
  "generic-git",
  "github",
  "gitlab",
  "bitbucket",
]);

/** Workspace-shared project metadata. Filesystem paths remain local to a cell. */
export const relayProjectSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    organizationId: workspaceIdSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2_000).optional(),
    repositoryKind: projectRepositoryKindSchema,
    providerId: projectProviderIdSchema,
    canonicalRemoteUrl: z.url().max(2_048).optional(),
    repositoryWebUrl: z.url().max(2_048).optional(),
    defaultBranch: z.string().trim().min(1).max(512),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const relayProjectCreateSchema = relayProjectSchema
  .omit({
    id: true,
    organizationId: true,
    createdAt: true,
    updatedAt: true,
  })
  .strict();

export const relayProjectsResultSchema = z
  .object({ projects: z.array(relayProjectSchema) })
  .strict();

export const relayProjectDeleteResultSchema = z
  .object({ id: z.string().trim().min(1).max(128), deleted: z.literal(true) })
  .strict();

export type RelayProject = z.infer<typeof relayProjectSchema>;
export type RelayProjectCreate = z.infer<typeof relayProjectCreateSchema>;
