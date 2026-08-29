import { z } from "zod";

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

const artifactRowsSchema = z.array(z.unknown());

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
  const rows = await request(manifest, "/artifacts", artifactRowsSchema);
  if (!Array.isArray(rows)) {
    throw new Error("The local artifact service returned an invalid list.");
  }
  return rows.flatMap((row): ExecutorArtifactSummary[] => {
    if (!row || !isJsonObject(row)) return [];
    const value = row;
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
      previewValue.kind === "layout" &&
      isJsonString(previewValue.markup)
        ? {
            kind: "layout" as const,
            markup: previewValue.markup,
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
