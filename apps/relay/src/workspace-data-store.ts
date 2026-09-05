import type { Principal } from "@chief/relay-contracts";
import {
  brandProfileResultSchema,
  brandProfileSaveSchema,
  brandProfileSchema,
  parseJsonValue,
  prospectSaveSchema,
  prospectSchema,
  prospectsResultSchema,
  workspaceFileAssetSchema,
  workspaceFileSaveSchema,
  workspaceFileSchema,
  workspaceFilesResultSchema,
  workspaceFileUpdateSchema,
} from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { requireAgentPrincipal } from "./agent-job-store";
import { HttpError, json, parseJson } from "./http";
import {
  initializeWorkspaceMachines,
  routeWorkspaceMachines,
} from "./workspace-machine-store";
import {
  initializeWorkspaceProjects,
  routeWorkspaceProjects,
} from "./workspace-project-store";

interface BrandRow extends Record<string, SqlStorageValue> {
  markdown: string;
  source_urls_json: string;
  version: number;
  author_agent_id: string;
  updated_at: string;
}

interface FileRow extends Record<string, SqlStorageValue> {
  file_id: string;
  path: string;
  title: string;
  mime_type: string;
  content: string;
  asset_json: string | null;
  conversation_id: string;
  author_agent_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ProspectRow extends Record<string, SqlStorageValue> {
  prospect_json: string;
}

export function initializeWorkspaceData(storage: DurableObjectStorage) {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS brand_profile (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      markdown TEXT NOT NULL,
      source_urls_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      author_agent_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_files (
      file_id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      author_agent_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prospects (
      prospect_id TEXT PRIMARY KEY,
      prospect_json TEXT NOT NULL,
      relevance TEXT NOT NULL,
      found_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prospects_recent_idx
      ON prospects (updated_at DESC);
  `);
  const columns = [
    ...storage.sql.exec<{ name: string }>("PRAGMA table_info(workspace_files)"),
  ];
  if (!columns.some((column) => column.name === "asset_json")) {
    storage.sql.exec("ALTER TABLE workspace_files ADD COLUMN asset_json TEXT");
  }
  initializeWorkspaceProjects(storage);
  initializeWorkspaceMachines(storage);
}

export async function routeWorkspaceData(
  storage: DurableObjectStorage,
  request: Request,
  operation: string,
  principal: Principal,
  workspaceId: string,
  channels: WorkspaceChannelStore,
) {
  const canRead = (conversationId: string) =>
    channels.canReadConversation(conversationId, principal);
  if (operation === "data-brand-get") return getBrandProfile(storage);
  if (operation === "data-brand-save") {
    requireAgentPrincipal(principal);
    return await saveBrandProfile(storage, request, principal.agentId);
  }
  if (operation === "data-prospects-list") return listProspects(storage);
  if (operation === "data-prospect-save") {
    requireAgentPrincipal(principal);
    return await saveProspect(storage, request, principal.agentId);
  }
  if (operation === "data-files-list") return listFiles(storage, canRead);
  if (operation === "data-file-asset-save") {
    requireAgentPrincipal(principal);
    return await saveFile(storage, request, principal.agentId, canRead, true);
  }
  if (operation === "data-file-save") {
    requireAgentPrincipal(principal);
    return await saveFile(storage, request, principal.agentId, canRead);
  }
  if (operation === "data-file-get") {
    return json(fileFromRow(readableFile(storage, request, canRead)));
  }
  if (operation === "data-file-update") {
    return await updateFile(storage, request, canRead);
  }
  const machines = await routeWorkspaceMachines(
    storage,
    request,
    operation,
    workspaceId,
  );
  return (
    machines ?? routeWorkspaceProjects(storage, request, operation, workspaceId)
  );
}

function getBrandProfile(storage: DurableObjectStorage) {
  const row = firstRow<BrandRow>(
    storage.sql.exec("SELECT * FROM brand_profile LIMIT 1"),
  );
  if (!row) return new Response(null, { status: 204 });
  return json(brandProfileSchema.parse(brandFromRow(row)));
}

async function saveBrandProfile(
  storage: DurableObjectStorage,
  request: Request,
  agentId: string,
) {
  const input = brandProfileSaveSchema.parse(await parseJson(request));
  const prior = firstRow<BrandRow>(
    storage.sql.exec("SELECT * FROM brand_profile LIMIT 1"),
  );
  const priorFile = firstRow<FileRow>(
    storage.sql.exec(
      "SELECT * FROM workspace_files WHERE file_id = 'brand-profile'",
    ),
  );
  const now = new Date().toISOString();
  const version = (prior?.version ?? 0) + 1;
  const createdAt = priorFile?.created_at ?? now;
  storage.sql.exec(
    `INSERT INTO brand_profile (
      singleton, markdown, source_urls_json, version, author_agent_id, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      markdown = excluded.markdown,
      source_urls_json = excluded.source_urls_json,
      version = excluded.version,
      author_agent_id = excluded.author_agent_id,
      updated_at = excluded.updated_at`,
    input.markdown,
    JSON.stringify(input.sourceUrls),
    version,
    agentId,
    now,
  );
  storage.sql.exec(
    `INSERT INTO workspace_files (
      file_id, path, title, mime_type, content, conversation_id,
      author_agent_id, version, created_at, updated_at
    ) VALUES ('brand-profile', 'brand/profile.md', 'Brand profile',
      'text/markdown', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      content = excluded.content,
      conversation_id = excluded.conversation_id,
      author_agent_id = excluded.author_agent_id,
      version = excluded.version,
      updated_at = excluded.updated_at`,
    input.markdown,
    input.conversationId,
    agentId,
    version,
    createdAt,
    now,
  );
  const profile = brandProfileSchema.parse({
    markdown: input.markdown,
    sourceUrls: input.sourceUrls,
    version,
    authorAgentId: agentId,
    updatedAt: now,
  });
  const fileRow = firstRow<FileRow>(
    storage.sql.exec(
      "SELECT * FROM workspace_files WHERE file_id = 'brand-profile'",
    ),
  );
  if (!fileRow) {
    throw new HttpError(
      500,
      "brand_profile_persistence_failed",
      "The saved brand profile could not be read back.",
    );
  }
  const file = fileFromRow(fileRow);
  return json(brandProfileResultSchema.parse({ profile, file }));
}

async function saveProspect(
  storage: DurableObjectStorage,
  request: Request,
  agentId: string,
) {
  const input = prospectSaveSchema.parse(await parseJson(request));
  const prior = firstRow<ProspectRow & { found_at: string }>(
    storage.sql.exec(
      "SELECT prospect_json, found_at FROM prospects WHERE prospect_id = ?",
      input.id,
    ),
  );
  const now = new Date().toISOString();
  const prospect = prospectSchema.parse({
    ...input,
    authorAgentId: agentId,
    foundAt: prior?.found_at ?? now,
    updatedAt: now,
  });
  storage.sql.exec(
    `INSERT INTO prospects (
      prospect_id, prospect_json, relevance, found_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(prospect_id) DO UPDATE SET
      prospect_json = excluded.prospect_json,
      relevance = excluded.relevance,
      updated_at = excluded.updated_at`,
    prospect.id,
    JSON.stringify(prospect),
    prospect.relevance,
    prospect.foundAt,
    prospect.updatedAt,
  );
  return json(prospect);
}

function listProspects(storage: DurableObjectStorage) {
  const prospects = [
    ...storage.sql.exec<ProspectRow>(
      "SELECT prospect_json FROM prospects ORDER BY updated_at DESC LIMIT 500",
    ),
  ].map((row) => prospectSchema.parse(JSON.parse(row.prospect_json)));
  return json(prospectsResultSchema.parse({ prospects }));
}

function listFiles(
  storage: DurableObjectStorage,
  canRead: (conversationId: string) => boolean,
) {
  const files = [
    ...storage.sql.exec<FileRow>(
      "SELECT * FROM workspace_files ORDER BY updated_at DESC",
    ),
  ]
    .filter((row) => canRead(row.conversation_id))
    .map(fileFromRow);
  return json(workspaceFilesResultSchema.parse({ files }));
}

async function saveFile(
  storage: DurableObjectStorage,
  request: Request,
  agentId: string,
  canRead: (conversationId: string) => boolean,
  assetUpload = false,
) {
  const payload = await parseJson(request);
  const mediaInput = assetUpload
    ? workspaceFileSaveSchema
        .extend({ asset: workspaceFileAssetSchema })
        .parse(payload)
    : null;
  const input = mediaInput ?? workspaceFileSaveSchema.parse(payload);
  const asset = mediaInput?.asset;
  if (!canRead(input.conversationId))
    throw new HttpError(
      404,
      "file_conversation_unavailable",
      "The file conversation is unavailable.",
    );
  if (asset && asset.agentId !== agentId) {
    throw new HttpError(
      403,
      "file_asset_owner",
      "The file must belong to the publishing agent.",
    );
  }
  const prior = firstRow<FileRow>(
    input.id
      ? storage.sql.exec(
          "SELECT * FROM workspace_files WHERE file_id = ? OR path = ? LIMIT 1",
          input.id,
          input.path,
        )
      : storage.sql.exec(
          "SELECT * FROM workspace_files WHERE path = ? LIMIT 1",
          input.path,
        ),
  );
  if (prior && !canRead(prior.conversation_id))
    throw new HttpError(404, "workspace_file_not_found", "File not found.");
  if (prior?.asset_json) {
    throw new HttpError(
      409,
      "media_file_read_only",
      "Publish a new media file instead of overwriting this output.",
    );
  }
  if (prior && input.expectedVersion !== prior.version) {
    throw new HttpError(
      409,
      "workspace_file_version_conflict",
      "This file changed since it was opened.",
    );
  }
  if (!prior && input.expectedVersion !== undefined) {
    throw new HttpError(
      409,
      "workspace_file_missing",
      "The file revision no longer exists.",
    );
  }
  const now = new Date().toISOString();
  const id = prior?.file_id ?? input.id ?? crypto.randomUUID();
  const version = (prior?.version ?? 0) + 1;
  storage.sql.exec(
    `INSERT INTO workspace_files (
      file_id, path, title, mime_type, content, conversation_id,
      author_agent_id, version, created_at, updated_at, asset_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      path = excluded.path,
      title = excluded.title,
      mime_type = excluded.mime_type,
      content = excluded.content,
      conversation_id = excluded.conversation_id,
      author_agent_id = excluded.author_agent_id,
      version = excluded.version,
      updated_at = excluded.updated_at`,
    id,
    input.path,
    input.title,
    input.mimeType,
    input.content,
    input.conversationId,
    agentId,
    version,
    prior?.created_at ?? now,
    now,
    asset ? JSON.stringify(asset) : null,
  );
  const row = firstRow<FileRow>(
    storage.sql.exec("SELECT * FROM workspace_files WHERE file_id = ?", id),
  );
  if (!row) throw new Error("Saved file could not be read back.");
  return json(workspaceFileSchema.parse(fileFromRow(row)), {
    status: prior ? 200 : 201,
  });
}

function readableFile(
  storage: DurableObjectStorage,
  request: Request,
  canRead: (conversationId: string) => boolean,
) {
  const fileId = request.headers.get("x-chief-workspace-file-id")?.trim();
  const row = fileId
    ? firstRow<FileRow>(
        storage.sql.exec(
          "SELECT * FROM workspace_files WHERE file_id = ?",
          fileId,
        ),
      )
    : undefined;
  if (!row || !canRead(row.conversation_id))
    throw new HttpError(404, "workspace_file_not_found", "File not found.");
  return row;
}

async function updateFile(
  storage: DurableObjectStorage,
  request: Request,
  canRead: (conversationId: string) => boolean,
) {
  const fileId = request.headers.get("x-chief-workspace-file-id")?.trim();
  if (!fileId) {
    throw new HttpError(
      400,
      "workspace_file_id_missing",
      "File id is required.",
    );
  }
  const input = workspaceFileUpdateSchema.parse(await parseJson(request));
  const prior = readableFile(storage, request, canRead);
  if (prior.asset_json) {
    throw new HttpError(
      409,
      "media_file_read_only",
      "Media files cannot be edited as text.",
    );
  }
  if (prior.version !== input.expectedVersion) {
    throw new HttpError(
      409,
      "workspace_file_version_conflict",
      "This file changed since it was opened.",
    );
  }
  const updatedAt = new Date().toISOString();
  const version = prior.version + 1;
  storage.sql.exec(
    `UPDATE workspace_files
     SET title = ?, content = ?, version = ?, updated_at = ?
     WHERE file_id = ?`,
    input.title,
    input.content,
    version,
    updatedAt,
    fileId,
  );
  const row = firstRow<FileRow>(
    storage.sql.exec("SELECT * FROM workspace_files WHERE file_id = ?", fileId),
  );
  if (!row) throw new Error("Updated file could not be read back.");
  return json(workspaceFileSchema.parse(fileFromRow(row)));
}

function brandFromRow(row: BrandRow) {
  return {
    markdown: row.markdown,
    sourceUrls: parseJsonValue(JSON.parse(row.source_urls_json)) ?? [],
    version: row.version,
    authorAgentId: row.author_agent_id,
    updatedAt: row.updated_at,
  };
}

function fileFromRow(row: FileRow) {
  return {
    id: row.file_id,
    path: row.path,
    title: row.title,
    mimeType: row.mime_type,
    content: row.content,
    ...(row.asset_json
      ? { asset: workspaceFileAssetSchema.parse(JSON.parse(row.asset_json)) }
      : undefined),
    conversationId: row.conversation_id,
    authorAgentId: row.author_agent_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  const next = cursor[Symbol.iterator]().next();
  return next.done ? undefined : next.value;
}
