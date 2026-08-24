import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

import type {
  ArtifactsMessage,
  ExecutorArtifactSummary,
  ListArtifactsMessage,
} from "../artifact-types.js";
import type { ExecutorCapability } from "../types.js";
import {
  ensureExecutorWorkspace,
  readManifest,
  request,
} from "./control-plane.js";

/** Lists the model-created UI artifacts owned by one isolated Chief workspace. */
export async function listExecutorArtifacts(
  workspaceId: string,
  capability: ExecutorCapability,
): Promise<ExecutorArtifactSummary[]> {
  const workspace = await ensureExecutorWorkspace(workspaceId, capability);
  const manifest = await readManifest(workspace.dataDir);
  if (!manifest) {
    throw new Error("The local artifact service is not running.");
  }
  const rows = await request<unknown>(manifest, "/artifacts");
  if (!Array.isArray(rows)) {
    throw new Error("The local artifact service returned an invalid list.");
  }
  return rows.flatMap((row): ExecutorArtifactSummary[] => {
    if (!row || !isJsonObject(row)) return [];
    const value = row as Record<string, unknown>;
    if (
      !isJsonString(value.id) ||
      !isJsonString(value.title) ||
      !isJsonNumber(value.createdAt) ||
      !isJsonNumber(value.updatedAt)
    ) {
      return [];
    }
    const previewValue = value.preview;
    const preview =
      previewValue &&
      isJsonObject(previewValue) &&
      (previewValue as Record<string, unknown>).kind === "layout" &&
      isJsonString((previewValue as Record<string, unknown>).markup)
        ? {
            kind: "layout" as const,
            markup: (previewValue as Record<string, unknown>).markup as string,
          }
        : null;
    return [
      {
        id: value.id,
        title: value.title,
        description: isJsonString(value.description) ? value.description : null,
        preview,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
      },
    ];
  });
}

export async function executorArtifactsMessage(
  message: ListArtifactsMessage,
): Promise<ArtifactsMessage> {
  return {
    type: "artifacts",
    workspaceId: message.workspaceId,
    artifacts: await listExecutorArtifacts(
      message.workspaceId,
      message.executorCapability,
    ),
  };
}
