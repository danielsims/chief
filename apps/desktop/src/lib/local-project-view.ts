import { z } from "zod";

import type {
  ProjectBranchComparison,
  ProjectCommitDetail,
  ProjectRepositoryBrowserSnapshot,
} from "@chief/agent-runtime/types";

const commitSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  parentHashes: z.array(z.string()).optional(),
  subject: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  authoredAt: z.number(),
});
const diffSchema = z.object({
  filesChanged: z.number(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string(),
  truncated: z.boolean(),
});

export const localProjectBrowserSchema: z.ZodType<ProjectRepositoryBrowserSnapshot> =
  z.object({
    projectId: z.string(),
    ref: z.string(),
    path: z.string(),
    kind: z.enum(["tree", "file"]),
    latestCommit: commitSchema.optional(),
    commits: z.array(commitSchema),
    entries: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        type: z.enum(["directory", "file", "submodule"]),
        size: z.number().optional(),
        lastCommit: commitSchema.optional(),
      }),
    ),
    contributors: z.array(
      z.object({ name: z.string(), email: z.string(), commits: z.number() }),
    ),
    readme: z
      .object({
        path: z.string(),
        content: z.string(),
        truncated: z.boolean(),
        imageSources: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    file: z
      .object({
        path: z.string(),
        size: z.number(),
        content: z.string().optional(),
        binary: z.boolean(),
        truncated: z.boolean(),
      })
      .optional(),
  });
export const localProjectCommitSchema: z.ZodType<ProjectCommitDetail> =
  diffSchema.extend({
    projectId: z.string(),
    ref: z.string(),
    commit: commitSchema,
  });
export const localProjectComparisonSchema: z.ZodType<ProjectBranchComparison> =
  diffSchema.extend({
    projectId: z.string(),
    baseRef: z.string(),
    compareRef: z.string(),
    mergeBase: z.string().optional(),
    ahead: z.number(),
    behind: z.number(),
    commits: z.array(commitSchema),
    mergeConflict: z.boolean().optional(),
    error: z.string().optional(),
  });

export const localProjectSnapshotsSchema = z.array(
  z.object({
    project: z.object({ id: z.string() }),
    binding: z
      .object({
        id: z.string(),
        organizationId: z.string(),
        projectId: z.string(),
        runtimeId: z.string(),
        kind: z.enum(["attached", "materialized"]),
        repositoryPath: z.string(),
        createdAt: z.number(),
        updatedAt: z.number(),
      })
      .optional(),
    available: z.boolean(),
    portable: z.boolean(),
    branch: z.string().optional(),
    head: z.string().optional(),
    clean: z.boolean().optional(),
    ahead: z.number().optional(),
    behind: z.number().optional(),
    changedFiles: z.number().optional(),
    branches: z.array(z.string()),
    branchSummaries: z
      .array(
        z.object({
          name: z.string(),
          shortHash: z.string(),
          subject: z.string(),
        }),
      )
      .optional(),
    commits: z.array(commitSchema),
    iconDataUrl: z.string().optional(),
    error: z.string().optional(),
  }),
);
