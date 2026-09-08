import {
  isJsonString,
  projectRepositoryFilesSchema,
  relayProjectCreateSchema,
  relayProjectDeleteResultSchema,
  relayProjectSchema,
  relayProjectsResultSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import type { ProjectRow } from "./workspace-project-git";
import { addProjectAgent } from "./db/migrations/add-project-agent";
import { addProjectRepositoryFiles } from "./db/migrations/add-project-repository-files";
import { getProjectColumns } from "./db/migrations/get-project-columns";
import { initializeProjectTables } from "./db/migrations/initialize-project-tables";
import { HttpError, json, parseJson } from "./http";
import { projectStoreMigrationsFindMigrateSnapshotProjects } from "./queries/project-store-migrations/find-migrate-snapshot-projects";
import { projectStoreMigrationsInsertMigrateSnapshotProjects } from "./queries/project-store-migrations/insert-migrate-snapshot-projects";
import { projectsDeleteRemove } from "./queries/projects/delete-remove";
import { projectsFindChiefGitRepositoryFiles } from "./queries/projects/find-chief-git-repository-files";
import { projectsFindCreateProject } from "./queries/projects/find-create-project";
import { projectsFindProjectIdsOwnedByAgent } from "./queries/projects/find-project-ids-owned-by-agent";
import { projectsFindSaveAgentProjectFiles } from "./queries/projects/find-save-agent-project-files";
import { projectsFindWorkspaceProjects } from "./queries/projects/find-workspace-projects";
import { projectsInsertMigrateSnapshotProjects } from "./queries/projects/insert-migrate-snapshot-projects";
import { projectsInsertSaveAgentProjectFiles } from "./queries/projects/insert-save-agent-project-files";
import { projectsUpdateBackfillAgentProjectFiles } from "./queries/projects/update-backfill-agent-project-files";
import { projectsUpdateSaveAgentProjectFiles } from "./queries/projects/update-save-agent-project-files";
import { workspaceFindWorkspaceAgent } from "./queries/workspace/find-workspace-agent";
import { workspaceUpdateVerifyConnection } from "./queries/workspace/update-verify-connection";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";
import {
  ensureProjectRepository,
  firstRow,
  normalizeProjectOwner,
  serveProjectGit,
} from "./workspace-project-git";

export { chiefGitRepositoryFiles } from "./workspace-project-git";

const SNAPSHOT_PROJECTS_MIGRATION = "snapshot-projects-v1";

export function initializeWorkspaceProjects(storage: DurableObjectStorage) {
  initializeProjectTables(storage);
  const columns = new Set(
    getProjectColumns<Record<string, SqlStorageValue>>(storage)
      .toArray()
      .map((column) => (isJsonString(column.name) ? column.name : "")),
  );
  if (!columns.has("agent_id")) {
    addProjectAgent(storage);
  }
  if (!columns.has("repository_files_json")) {
    addProjectRepositoryFiles(storage);
  }
  for (const project of projectsFindChiefGitRepositoryFiles<ProjectRow>(
    storage,
  )) {
    ensureProjectRepository(storage, project);
  }
}

export async function routeWorkspaceProjects(
  storage: DurableObjectStorage,
  request: Request,
  operation: string,
  workspaceId: string,
) {
  if (operation === "data-projects-list") {
    return listProjects(storage, workspaceId);
  }
  if (operation === "data-project-create") {
    return await createProject(storage, request, workspaceId);
  }
  if (operation === "data-project-delete") {
    return deleteProject(storage, request, workspaceId);
  }
  if (
    operation === "git-info-refs" ||
    operation === "git-upload-pack" ||
    operation === "git-receive-pack"
  ) {
    return await serveProjectGit(storage, request, operation);
  }
  return null;
}

export function workspaceProjects(
  storage: DurableObjectStorage,
  workspaceId: string,
) {
  migrateSnapshotProjects(storage, workspaceId);
  backfillAgentProjectFiles(storage);
  const organizationId = workspaceIdSchema.parse(workspaceId);
  return [...projectsFindWorkspaceProjects<ProjectRow>(storage)].map((row) =>
    relayProjectSchema.parse(projectFromRow(row, organizationId)),
  );
}

function backfillAgentProjectFiles(storage: DurableObjectStorage) {
  const workspace = firstRow<{ snapshot_json: string | null }>(
    workspaceFindWorkspaceAgent(storage),
  );
  if (!workspace?.snapshot_json) return;
  const agents = decodeWorkspaceSnapshot(workspace.snapshot_json).agents;
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  for (const project of projectsFindChiefGitRepositoryFiles<ProjectRow>(
    storage,
  )) {
    if (
      project.repository_files_json &&
      !hasLegacyUndefinedReadme(project.repository_files_json)
    ) {
      continue;
    }
    const projectOwner = normalizeProjectOwner(project.name);
    const agent = project.agent_id
      ? agentsById.get(project.agent_id)
      : agents.find((candidate) => {
          const id = normalizeProjectOwner(candidate.id);
          const name = normalizeProjectOwner(candidate.name);
          return (
            projectOwner === id ||
            projectOwner === name ||
            projectOwner === `${id}-agent` ||
            projectOwner === `${name}-agent`
          );
        });
    if (!agent) continue;
    const description = agent.description.trim();
    const instructions =
      agent.instructions.trim() || `# ${agent.role}\n\n${description}`;
    const files = [
      {
        path: "README.md",
        content: `# ${agent.name}\n\n${description}\n`,
      },
      {
        path: "agent/identity.json",
        content: `${JSON.stringify(
          {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            description,
          },
          null,
          2,
        )}\n`,
      },
      {
        path: "agent/instructions.md",
        content: `${instructions}\n`,
      },
    ];
    projectsUpdateBackfillAgentProjectFiles(storage, {
      agentId: agent.id,
      description: description,
      repositoryFilesJson: JSON.stringify(files),
      projectId: project.project_id,
    });
  }
}

function hasLegacyUndefinedReadme(repositoryFilesJson: string) {
  let value: unknown;
  try {
    value = JSON.parse(repositoryFilesJson);
  } catch {
    return false;
  }
  const parsed = projectRepositoryFilesSchema.safeParse(value);
  if (!parsed.success) return false;
  return parsed.data.some(
    (file) =>
      file.path === "README.md" && /\n\nundefined\s*$/u.test(file.content),
  );
}

export function saveAgentProjectFiles(
  storage: DurableObjectStorage,
  workspaceId: string,
  input: {
    agentId: string;
    name: string;
    description: string;
    files: readonly { path: string; contents: string }[];
    canonicalRemoteUrl: string;
  },
) {
  migrateSnapshotProjects(storage, workspaceId);
  const now = new Date().toISOString();
  const repositoryFiles = JSON.stringify(
    input.files.map((file) => ({ path: file.path, content: file.contents })),
  );
  const existing = firstRow<ProjectRow>(
    projectsFindSaveAgentProjectFiles(storage, input.agentId),
  );
  if (existing) {
    projectsUpdateSaveAgentProjectFiles(storage, {
      name: input.name,
      description: input.description,
      providerId: "chief-git",
      canonicalRemoteUrl: input.canonicalRemoteUrl,
      repositoryWebUrl: input.canonicalRemoteUrl.replace(/\.git$/u, ""),
      repositoryFilesJson: repositoryFiles,
      updatedAt: now,
      projectId: existing.project_id,
    });
  } else {
    projectsInsertSaveAgentProjectFiles(storage, {
      projectId: crypto.randomUUID(),
      agentId: input.agentId,
      name: input.name,
      description: input.description,
      repositoryKind: "cloned",
      providerId: "chief-git",
      canonicalRemoteUrl: input.canonicalRemoteUrl,
      repositoryWebUrl: input.canonicalRemoteUrl.replace(/\.git$/u, ""),
      repositoryFilesJson: repositoryFiles,
      defaultBranch: "main",
      createdAt: now,
      updatedAt: now,
    });
  }
  const saved = firstRow<ProjectRow>(
    projectsFindSaveAgentProjectFiles(storage, input.agentId),
  );
  if (saved) ensureProjectRepository(storage, saved);
  syncSnapshotProjects(storage, workspaceId);
}

function listProjects(storage: DurableObjectStorage, workspaceId: string) {
  return json(
    relayProjectsResultSchema.parse({
      projects: workspaceProjects(storage, workspaceId),
    }),
  );
}

async function createProject(
  storage: DurableObjectStorage,
  request: Request,
  workspaceId: string,
) {
  migrateSnapshotProjects(storage, workspaceId);
  const input = relayProjectCreateSchema.parse(await parseJson(request));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    projectsInsertSaveAgentProjectFiles(storage, {
      projectId: id,
      agentId: input.agentId ?? null,
      name: input.name,
      description: input.description ?? null,
      repositoryKind: input.repositoryKind,
      providerId: input.providerId,
      canonicalRemoteUrl: input.canonicalRemoteUrl ?? null,
      repositoryWebUrl: input.repositoryWebUrl ?? null,
      repositoryFilesJson: input.repositoryFiles
        ? JSON.stringify(input.repositoryFiles)
        : null,
      defaultBranch: input.defaultBranch,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (input.canonicalRemoteUrl) {
      throw new HttpError(
        409,
        "project_remote_exists",
        "This repository is already registered in the workspace.",
      );
    }
    throw error;
  }
  syncSnapshotProjects(storage, workspaceId);
  const row = firstRow<ProjectRow>(projectsFindCreateProject(storage, id));
  if (row) ensureProjectRepository(storage, row);
  if (!row) throw new Error("Created project could not be read back.");
  ensureProjectRepository(storage, row);
  return json(
    relayProjectSchema.parse(
      projectFromRow(row, workspaceIdSchema.parse(workspaceId)),
    ),
    { status: 201 },
  );
}

function deleteProject(
  storage: DurableObjectStorage,
  request: Request,
  workspaceId: string,
) {
  migrateSnapshotProjects(storage, workspaceId);
  const projectId = request.headers.get("x-chief-project-id")?.trim();
  if (!projectId) {
    throw new HttpError(400, "project_id_missing", "Project id is required.");
  }
  const existing = firstRow<ProjectRow>(
    projectsFindCreateProject(storage, projectId),
  );
  if (!existing) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }
  projectsDeleteRemove(storage, projectId);
  syncSnapshotProjects(storage, workspaceId);
  return json(
    relayProjectDeleteResultSchema.parse({ id: projectId, deleted: true }),
  );
}

function projectFromRow(
  row: ProjectRow,
  organizationId: ReturnType<typeof workspaceIdSchema.parse>,
) {
  return {
    id: row.project_id,
    organizationId,
    ...(row.agent_id ? { agentId: row.agent_id } : undefined),
    name: row.name,
    ...(row.description ? { description: row.description } : undefined),
    repositoryKind: row.repository_kind,
    providerId: row.provider_id,
    ...(row.canonical_remote_url
      ? { canonicalRemoteUrl: row.canonical_remote_url }
      : undefined),
    ...(row.repository_web_url
      ? { repositoryWebUrl: row.repository_web_url }
      : undefined),
    ...(row.repository_files_json
      ? {
          repositoryFiles: projectRepositoryFilesSchema.parse(
            JSON.parse(row.repository_files_json),
          ),
        }
      : undefined),
    defaultBranch: row.default_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function syncSnapshotProjects(
  storage: DurableObjectStorage,
  workspaceId: string,
) {
  const row = firstRow<{ snapshot_json: string | null }>(
    workspaceFindWorkspaceAgent(storage),
  );
  if (!row?.snapshot_json) return;
  const snapshot = decodeWorkspaceSnapshot(row.snapshot_json);
  workspaceUpdateVerifyConnection(
    storage,
    JSON.stringify({
      ...snapshot,
      projects: workspaceProjects(storage, workspaceId),
    }),
  );
}

export function migrateSnapshotProjects(
  storage: DurableObjectStorage,
  workspaceId: string,
) {
  const migrated = firstRow<{ migration_id: string }>(
    projectStoreMigrationsFindMigrateSnapshotProjects(
      storage,
      SNAPSHOT_PROJECTS_MIGRATION,
    ),
  );
  if (migrated) return;
  const row = firstRow<{ snapshot_json: string | null }>(
    workspaceFindWorkspaceAgent(storage),
  );
  if (!row?.snapshot_json) return;
  const snapshot = decodeWorkspaceSnapshot(row.snapshot_json);
  const organizationId = workspaceIdSchema.parse(workspaceId);
  storage.transactionSync(() => {
    for (const project of snapshot.projects) {
      if (project.organizationId !== organizationId) continue;
      projectsInsertMigrateSnapshotProjects(storage, {
        projectId: project.id,
        agentId: project.agentId ?? null,
        name: project.name,
        description: project.description ?? null,
        repositoryKind: project.repositoryKind,
        providerId: project.providerId,
        canonicalRemoteUrl: project.canonicalRemoteUrl ?? null,
        repositoryWebUrl: project.repositoryWebUrl ?? null,
        repositoryFilesJson: project.repositoryFiles
          ? JSON.stringify(project.repositoryFiles)
          : null,
        defaultBranch: project.defaultBranch,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
      const row = firstRow<ProjectRow>(
        projectsFindCreateProject(storage, project.id),
      );
      if (row) ensureProjectRepository(storage, row);
    }
    projectStoreMigrationsInsertMigrateSnapshotProjects(
      storage,
      SNAPSHOT_PROJECTS_MIGRATION,
      new Date().toISOString(),
    );
  });
}

export function projectIdsOwnedByAgent(
  storage: DurableObjectStorage,
  workspaceId: string,
  agentId: string,
) {
  migrateSnapshotProjects(storage, workspaceId);
  const normalizedAgentId = normalizeProjectOwner(agentId);
  return projectsFindProjectIdsOwnedByAgent<
    Pick<ProjectRow, "project_id" | "agent_id" | "name">
  >(storage)
    .filter((project) => {
      if (project.agent_id === agentId) return true;
      const name = normalizeProjectOwner(project.name);
      return (
        name === normalizedAgentId || name === `${normalizedAgentId}-agent`
      );
    })
    .map((project) => project.project_id);
}
