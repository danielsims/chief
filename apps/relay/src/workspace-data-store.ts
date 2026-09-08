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
import { addWorkspaceFileAsset } from "./db/migrations/add-workspace-file-asset";
import { getWorkspaceFileColumns } from "./db/migrations/get-workspace-file-columns";
import { initializeWorkspaceDataTables } from "./db/migrations/initialize-workspace-data-tables";
import { HttpError, json, parseJson } from "./http";
import { brandProfileFindGetBrandProfile } from "./queries/brand-profile/find-get-brand-profile";
import { brandProfileInsertSaveBrandProfile } from "./queries/brand-profile/insert-save-brand-profile";
import { prospectsFindListProspects } from "./queries/prospects/find-list-prospects";
import { prospectsFindSaveProspect } from "./queries/prospects/find-save-prospect";
import { prospectsInsertSaveProspect } from "./queries/prospects/insert-save-prospect";
import { workspaceFilesFindListFiles } from "./queries/workspace-files/find-list-files";
import { workspaceFilesFindSaveBrandProfile } from "./queries/workspace-files/find-save-brand-profile";
import { workspaceFilesFindSaveFile } from "./queries/workspace-files/find-save-file";
import { workspaceFilesFindSaveFileFileId } from "./queries/workspace-files/find-save-file-file-id";
import { workspaceFilesFindSaveFilePath } from "./queries/workspace-files/find-save-file-path";
import { workspaceFilesInsertSaveBrandProfile } from "./queries/workspace-files/insert-save-brand-profile";
import { workspaceFilesInsertSaveFile } from "./queries/workspace-files/insert-save-file";
import { workspaceFilesUpdateUpdateFile } from "./queries/workspace-files/update-update-file";
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
  initializeWorkspaceDataTables(storage);
  const columns = [...getWorkspaceFileColumns<{ name: string }>(storage)];
  if (!columns.some((column) => column.name === "asset_json")) {
    addWorkspaceFileAsset(storage);
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
  const row = firstRow<BrandRow>(brandProfileFindGetBrandProfile(storage));
  if (!row) return new Response(null, { status: 204 });
  return json(brandProfileSchema.parse(brandFromRow(row)));
}

async function saveBrandProfile(
  storage: DurableObjectStorage,
  request: Request,
  agentId: string,
) {
  const input = brandProfileSaveSchema.parse(await parseJson(request));
  const prior = firstRow<BrandRow>(brandProfileFindGetBrandProfile(storage));
  const priorFile = firstRow<FileRow>(
    workspaceFilesFindSaveBrandProfile(storage),
  );
  const now = new Date().toISOString();
  const version = (prior?.version ?? 0) + 1;
  const createdAt = priorFile?.created_at ?? now;
  brandProfileInsertSaveBrandProfile(storage, {
    markdown: input.markdown,
    sourceUrlsJson: JSON.stringify(input.sourceUrls),
    version: version,
    authorAgentId: agentId,
    updatedAt: now,
  });
  workspaceFilesInsertSaveBrandProfile(storage, {
    content: input.markdown,
    conversationId: input.conversationId,
    authorAgentId: agentId,
    version: version,
    createdAt: createdAt,
    updatedAt: now,
  });
  const profile = brandProfileSchema.parse({
    markdown: input.markdown,
    sourceUrls: input.sourceUrls,
    version,
    authorAgentId: agentId,
    updatedAt: now,
  });
  const fileRow = firstRow<FileRow>(
    workspaceFilesFindSaveBrandProfile(storage),
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
    prospectsFindSaveProspect(storage, input.id),
  );
  const now = new Date().toISOString();
  const prospect = prospectSchema.parse({
    ...input,
    authorAgentId: agentId,
    foundAt: prior?.found_at ?? now,
    updatedAt: now,
  });
  prospectsInsertSaveProspect(storage, {
    prospectId: prospect.id,
    prospectJson: JSON.stringify(prospect),
    relevance: prospect.relevance,
    foundAt: prospect.foundAt,
    updatedAt: prospect.updatedAt,
  });
  return json(prospect);
}

function listProspects(storage: DurableObjectStorage) {
  const prospects = [...prospectsFindListProspects<ProspectRow>(storage)].map(
    (row) => prospectSchema.parse(JSON.parse(row.prospect_json)),
  );
  return json(prospectsResultSchema.parse({ prospects }));
}

function listFiles(
  storage: DurableObjectStorage,
  canRead: (conversationId: string) => boolean,
) {
  const files = [...workspaceFilesFindListFiles<FileRow>(storage)]
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
      ? workspaceFilesFindSaveFile(storage, input.id, input.path)
      : workspaceFilesFindSaveFilePath(storage, input.path),
  );
  if (prior && !canRead(prior.conversation_id))
    throw new HttpError(404, "workspace_file_not_found", "File not found.");
  if (prior && prior.conversation_id !== input.conversationId) {
    throw new HttpError(
      409,
      "artifact_channel_fixed",
      "Create a new artifact to share this work in another channel.",
    );
  }
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
  workspaceFilesInsertSaveFile(storage, {
    fileId: id,
    path: input.path,
    title: input.title,
    mimeType: input.mimeType,
    content: input.content,
    conversationId: input.conversationId,
    authorAgentId: agentId,
    version: version,
    createdAt: prior?.created_at ?? now,
    updatedAt: now,
    assetJson: asset ? JSON.stringify(asset) : null,
  });
  const row = firstRow<FileRow>(workspaceFilesFindSaveFileFileId(storage, id));
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
    ? firstRow<FileRow>(workspaceFilesFindSaveFileFileId(storage, fileId))
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
  workspaceFilesUpdateUpdateFile(storage, {
    title: input.title,
    content: input.content,
    version: version,
    updatedAt: updatedAt,
    fileId: fileId,
  });
  const row = firstRow<FileRow>(
    workspaceFilesFindSaveFileFileId(storage, fileId),
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
