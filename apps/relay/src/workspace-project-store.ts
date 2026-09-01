import {
  isJsonString,
  projectRepositoryFilesSchema,
  relayProjectCreateSchema,
  relayProjectDeleteResultSchema,
  relayProjectSchema,
  relayProjectsResultSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { githubRepositoryIdentity } from "./project-repository";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";

const SNAPSHOT_PROJECTS_MIGRATION = "snapshot-projects-v1";

interface ProjectRow extends Record<string, SqlStorageValue> {
  project_id: string;
  agent_id: string | null;
  name: string;
  description: string | null;
  repository_kind: "attached" | "cloned";
  provider_id:
    "local" | "generic-git" | "github" | "chief-git" | "gitlab" | "bitbucket";
  canonical_remote_url: string | null;
  repository_web_url: string | null;
  repository_files_json: string | null;
  default_branch: string;
  created_at: string;
  updated_at: string;
}

export function initializeWorkspaceProjects(storage: DurableObjectStorage) {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      agent_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      repository_kind TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      canonical_remote_url TEXT,
      repository_web_url TEXT,
      repository_files_json TEXT,
      default_branch TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS projects_remote_unique
      ON projects (canonical_remote_url)
      WHERE canonical_remote_url IS NOT NULL;
    CREATE INDEX IF NOT EXISTS projects_updated_idx
      ON projects (updated_at DESC);
    CREATE TABLE IF NOT EXISTS project_store_migrations (
      migration_id TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_repositories (
      repository_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      provider_id TEXT NOT NULL,
      canonical_remote_url TEXT NOT NULL,
      provider_repository_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `);
  const columns = new Set(
    storage.sql
      .exec<Record<string, SqlStorageValue>>("PRAGMA table_info(projects)")
      .toArray()
      .map((column) => (isJsonString(column.name) ? column.name : "")),
  );
  if (!columns.has("agent_id")) {
    storage.sql.exec("ALTER TABLE projects ADD COLUMN agent_id TEXT");
  }
  if (!columns.has("repository_files_json")) {
    storage.sql.exec(
      "ALTER TABLE projects ADD COLUMN repository_files_json TEXT",
    );
  }
  for (const project of storage.sql
    .exec<ProjectRow>("SELECT * FROM projects")
    .toArray()) {
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
  return null;
}

export function workspaceProjects(
  storage: DurableObjectStorage,
  workspaceId: string,
) {
  migrateSnapshotProjects(storage, workspaceId);
  backfillAgentProjectFiles(storage);
  const organizationId = workspaceIdSchema.parse(workspaceId);
  return [
    ...storage.sql.exec<ProjectRow>(
      "SELECT * FROM projects ORDER BY updated_at DESC",
    ),
  ].map((row) => relayProjectSchema.parse(projectFromRow(row, organizationId)));
}

function backfillAgentProjectFiles(storage: DurableObjectStorage) {
  const workspace = firstRow<{ snapshot_json: string | null }>(
    storage.sql.exec("SELECT snapshot_json FROM workspace WHERE singleton = 1"),
  );
  if (!workspace?.snapshot_json) return;
  const agents = decodeWorkspaceSnapshot(workspace.snapshot_json).agents;
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  for (const project of storage.sql
    .exec<ProjectRow>("SELECT * FROM projects")
    .toArray()) {
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
    const description = agent.description?.trim() ?? agent.role;
    const instructions =
      agent.instructions?.trim() ?? `# ${agent.role}\n\n${description}`;
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
    storage.sql.exec(
      "UPDATE projects SET agent_id = ?, description = ?, repository_files_json = ? WHERE project_id = ?",
      agent.id,
      description,
      JSON.stringify(files),
      project.project_id,
    );
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
  },
) {
  migrateSnapshotProjects(storage, workspaceId);
  const now = new Date().toISOString();
  const repositoryFiles = JSON.stringify(
    input.files.map((file) => ({ path: file.path, content: file.contents })),
  );
  const existing = firstRow<ProjectRow>(
    storage.sql.exec(
      "SELECT * FROM projects WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 1",
      input.agentId,
    ),
  );
  if (existing) {
    storage.sql.exec(
      `UPDATE projects
       SET name = ?, description = ?, provider_id = ?, repository_files_json = ?, updated_at = ?
       WHERE project_id = ?`,
      input.name,
      input.description,
      "chief-git",
      repositoryFiles,
      now,
      existing.project_id,
    );
  } else {
    storage.sql.exec(
      `INSERT INTO projects (
        project_id, agent_id, name, description, repository_kind, provider_id,
        canonical_remote_url, repository_web_url, repository_files_json,
        default_branch, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      input.agentId,
      input.name,
      input.description,
      "cloned",
      "chief-git",
      null,
      null,
      repositoryFiles,
      "main",
      now,
      now,
    );
  }
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
    storage.sql.exec(
      `INSERT INTO projects (
        project_id, agent_id, name, description, repository_kind, provider_id,
        canonical_remote_url, repository_web_url, repository_files_json, default_branch,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.agentId ?? null,
      input.name,
      input.description ?? null,
      input.repositoryKind,
      input.providerId,
      input.canonicalRemoteUrl ?? null,
      input.repositoryWebUrl ?? null,
      input.repositoryFiles ? JSON.stringify(input.repositoryFiles) : null,
      input.defaultBranch,
      now,
      now,
    );
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
  const row = firstRow<ProjectRow>(
    storage.sql.exec("SELECT * FROM projects WHERE project_id = ?", id),
  );
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
    storage.sql.exec("SELECT * FROM projects WHERE project_id = ?", projectId),
  );
  if (!existing) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }
  storage.sql.exec("DELETE FROM projects WHERE project_id = ?", projectId);
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
    storage.sql.exec("SELECT snapshot_json FROM workspace WHERE singleton = 1"),
  );
  if (!row?.snapshot_json) return;
  const snapshot = decodeWorkspaceSnapshot(row.snapshot_json);
  storage.sql.exec(
    "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
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
    storage.sql.exec(
      "SELECT migration_id FROM project_store_migrations WHERE migration_id = ?",
      SNAPSHOT_PROJECTS_MIGRATION,
    ),
  );
  if (migrated) return;
  const row = firstRow<{ snapshot_json: string | null }>(
    storage.sql.exec("SELECT snapshot_json FROM workspace WHERE singleton = 1"),
  );
  if (!row?.snapshot_json) return;
  const snapshot = decodeWorkspaceSnapshot(row.snapshot_json);
  const organizationId = workspaceIdSchema.parse(workspaceId);
  storage.transactionSync(() => {
    for (const project of snapshot.projects) {
      if (project.organizationId !== organizationId) continue;
      storage.sql.exec(
        `INSERT OR IGNORE INTO projects (
          project_id, agent_id, name, description, repository_kind, provider_id,
          canonical_remote_url, repository_web_url, repository_files_json, default_branch,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        project.id,
        project.agentId ?? null,
        project.name,
        project.description ?? null,
        project.repositoryKind,
        project.providerId,
        project.canonicalRemoteUrl ?? null,
        project.repositoryWebUrl ?? null,
        project.repositoryFiles
          ? JSON.stringify(project.repositoryFiles)
          : null,
        project.defaultBranch,
        project.createdAt,
        project.updatedAt,
      );
      const row = firstRow<ProjectRow>(
        storage.sql.exec(
          "SELECT * FROM projects WHERE project_id = ?",
          project.id,
        ),
      );
      if (row) ensureProjectRepository(storage, row);
    }
    storage.sql.exec(
      "INSERT INTO project_store_migrations (migration_id, completed_at) VALUES (?, ?)",
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
  return storage.sql
    .exec<Pick<ProjectRow, "project_id" | "agent_id" | "name">>(
      "SELECT project_id, agent_id, name FROM projects",
    )
    .toArray()
    .filter((project) => {
      if (project.agent_id === agentId) return true;
      const name = normalizeProjectOwner(project.name);
      return (
        name === normalizedAgentId || name === `${normalizedAgentId}-agent`
      );
    })
    .map((project) => project.project_id);
}

function ensureProjectRepository(
  storage: DurableObjectStorage,
  project: ProjectRow,
) {
  if (!project.canonical_remote_url) return;
  const github = githubRepositoryIdentity(project.canonical_remote_url);
  const provider = github
    ? { id: "github", identity: `${github.owner}/${github.name}` }
    : project.provider_id === "chief-git"
      ? { id: "chief-git", identity: project.project_id }
      : null;
  if (!provider) return;
  storage.sql.exec(
    `INSERT OR IGNORE INTO project_repositories (
      repository_id, project_id, provider_id, canonical_remote_url,
      provider_repository_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    project.project_id,
    provider.id,
    project.canonical_remote_url,
    provider.identity,
    project.created_at,
  );
}

function normalizeProjectOwner(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  const next = cursor[Symbol.iterator]().next();
  return next.done ? undefined : next.value;
}
