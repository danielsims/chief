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
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    if (
      typeof value.id !== "string" ||
      typeof value.title !== "string" ||
      typeof value.createdAt !== "number" ||
      typeof value.updatedAt !== "number"
    ) {
      return [];
    }
    const previewValue = value.preview;
    const preview =
      previewValue &&
      typeof previewValue === "object" &&
      (previewValue as Record<string, unknown>).kind === "layout" &&
      typeof (previewValue as Record<string, unknown>).markup === "string"
        ? {
            kind: "layout" as const,
            markup: (previewValue as Record<string, unknown>).markup as string,
          }
        : null;
    return [
      {
        id: value.id,
        title: value.title,
        description:
          typeof value.description === "string" ? value.description : null,
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
