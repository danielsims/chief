import type { Principal } from "@chief/relay-contracts";
import {
  brandProfileResultSchema,
  brandProfileSaveSchema,
  brandProfileSchema,
  prospectSaveSchema,
  prospectSchema,
  prospectsResultSchema,
  workspaceFilesResultSchema,
} from "@chief/relay-contracts";

import { requireAgentPrincipal } from "./agent-job-store";
import { HttpError, json, parseJson } from "./http";

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
}

export async function routeWorkspaceData(
  storage: DurableObjectStorage,
  request: Request,
  operation: string,
  principal: Principal,
) {
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
  if (operation === "data-files-list") return listFiles(storage);
  return null;
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

function listFiles(storage: DurableObjectStorage) {
  const files = [
    ...storage.sql.exec<FileRow>(
      "SELECT * FROM workspace_files ORDER BY updated_at DESC",
    ),
  ].map(fileFromRow);
  return json(workspaceFilesResultSchema.parse({ files }));
}

function brandFromRow(row: BrandRow) {
  return {
    markdown: row.markdown,
    sourceUrls: JSON.parse(row.source_urls_json) as unknown,
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
    conversationId: row.conversation_id,
    authorAgentId: row.author_agent_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}
