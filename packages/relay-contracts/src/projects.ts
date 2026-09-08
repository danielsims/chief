import { z } from "zod";

import {
  agentIdSchema,
  isoDateTimeSchema,
  workspaceIdSchema,
} from "./identifiers";

export const projectRemoteUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      ["https:", "ssh:"].includes(url.protocol) &&
      !url.password &&
      !(url.protocol === "https:" && url.username) &&
      !url.search &&
      !url.hash &&
      !/[\r\n\0]/u.test(value)
    );
  }, "Use an HTTPS or SSH repository URL without embedded credentials, a query, or a fragment.");

export const projectRepositoryKindSchema = z.enum(["attached", "cloned"]);
export const projectProviderIdSchema = z.enum([
  "local",
  "generic-git",
  "github",
  "chief-git",
  "gitlab",
  "bitbucket",
]);
export const projectRepositorySourceFileSchema = z.object({
  path: z.string().trim().min(1).max(1_024),
  content: z.string().max(1_000_000),
});
export const projectRepositoryFilesSchema = z
  .array(projectRepositorySourceFileSchema)
  .max(1_000);

/** Workspace-shared project metadata. Filesystem paths remain local to a cell. */
export const relayProjectSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    organizationId: workspaceIdSchema,
    agentId: agentIdSchema.optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2_000).optional(),
    repositoryKind: projectRepositoryKindSchema,
    providerId: projectProviderIdSchema,
    canonicalRemoteUrl: projectRemoteUrlSchema.optional(),
    repositoryWebUrl: projectRemoteUrlSchema
      .refine(
        (value) => new URL(value).protocol === "https:",
        "Use an HTTPS repository page URL.",
      )
      .optional(),
    repositoryFiles: projectRepositoryFilesSchema.optional(),
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
