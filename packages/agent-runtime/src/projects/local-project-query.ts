import { z } from "zod";

import { compareRepositoryBranches } from "./compare.js";
import { listLocalProjectBindings } from "./local-projects.js";
import {
  browseRepository,
  inspectRepositoryCommit,
} from "./repository-browser.js";
import { repositorySnapshot } from "./repository-git.js";

const scope = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  ref: z.string().min(1),
});
const querySchema = z.discriminatedUnion("operation", [
  z.object({
    workspaceId: z.string().min(1),
    operation: z.literal("snapshots"),
  }),
  scope.extend({ operation: z.literal("browse"), path: z.string().optional() }),
  scope.extend({ operation: z.literal("commit"), commit: z.string().min(1) }),
  z.object({
    workspaceId: z.string().min(1),
    projectId: z.string().min(1),
    operation: z.literal("compare"),
    baseRef: z.string().min(1),
    compareRef: z.string().min(1),
  }),
]);

type LocalProjectQuery = z.infer<typeof querySchema>;

export function parseLocalProjectQuery(input: unknown) {
  return querySchema.parse(input);
}

export async function queryLocalProject(
  query: LocalProjectQuery,
  root?: string,
) {
  const bindings = await listLocalProjectBindings(query.workspaceId, root);
  if (query.operation === "snapshots") {
    return {
      snapshots: await Promise.all(
        bindings.map((binding) =>
          repositorySnapshot(
            {
              ...binding.project,
              id: binding.projectId,
              organizationId: query.workspaceId,
              createdAt: 0,
              updatedAt: 0,
            },
            {
              id: binding.connectionId,
              organizationId: query.workspaceId,
              projectId: binding.projectId,
              runtimeId: "desktop",
              kind:
                binding.project.repositoryKind === "attached"
                  ? "attached"
                  : "materialized",
              repositoryPath: binding.repositoryPath,
              createdAt: 0,
              updatedAt: 0,
            },
            [],
          ),
        ),
      ),
    };
  }
  const binding = bindings.find(
    (candidate) => candidate.projectId === query.projectId,
  );
  if (!binding)
    throw new Error("Connect this repository on this Mac to browse it.");
  switch (query.operation) {
    case "browse":
      return {
        browser: await browseRepository(
          query.projectId,
          binding.repositoryPath,
          query.ref,
          query.path,
        ),
      };
    case "commit":
      return {
        detail: await inspectRepositoryCommit(
          query.projectId,
          binding.repositoryPath,
          query.ref,
          query.commit,
        ),
      };
    case "compare":
      return {
        comparison: await compareRepositoryBranches(
          query.projectId,
          binding.repositoryPath,
          query.baseRef,
          query.compareRef,
        ),
      };
  }
}
