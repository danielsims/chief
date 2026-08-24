import {
  relayProjectCreateSchema,
  relayProjectDeleteResultSchema,
  relayProjectSchema,
  relayProjectsResultSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";

interface ProjectRow extends Record<string, SqlStorageValue> {
  project_id: string;
  name: string;
  description: string | null;
  repository_kind: "attached" | "cloned";
  provider_id: "local" | "generic-git" | "github" | "gitlab" | "bitbucket";
  canonical_remote_url: string | null;
  repository_web_url: string | null;
  default_branch: string;
  created_at: string;
  updated_at: string;
}

export function initializeWorkspaceProjects(storage: DurableObjectStorage) {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      repository_kind TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      canonical_remote_url TEXT,
      repository_web_url TEXT,
      default_branch TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS projects_remote_unique
      ON projects (canonical_remote_url)
      WHERE canonical_remote_url IS NOT NULL;
    CREATE INDEX IF NOT EXISTS projects_updated_idx
      ON projects (updated_at DESC);
  `);
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
  const organizationId = workspaceIdSchema.parse(workspaceId);
  return [
    ...storage.sql.exec<ProjectRow>(
      "SELECT * FROM projects ORDER BY updated_at DESC",
    ),
  ].map((row) => relayProjectSchema.parse(projectFromRow(row, organizationId)));
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
  const input = relayProjectCreateSchema.parse(await parseJson(request));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    storage.sql.exec(
      `INSERT INTO projects (
        project_id, name, description, repository_kind, provider_id,
        canonical_remote_url, repository_web_url, default_branch,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.description ?? null,
      input.repositoryKind,
      input.providerId,
      input.canonicalRemoteUrl ?? null,
      input.repositoryWebUrl ?? null,
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
  const snapshot = JSON.parse(row.snapshot_json) as Record<string, unknown>;
  snapshot.projects = workspaceProjects(storage, workspaceId);
  storage.sql.exec(
    "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
    JSON.stringify(snapshot),
  );
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}
