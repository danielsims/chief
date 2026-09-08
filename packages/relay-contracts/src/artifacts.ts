import { z } from "zod";

import type { JsonValue } from "./json";
import type { WorkspaceFile } from "./workspace-data";
import { conversationIdSchema } from "./identifiers";

export const artifactReferencePayloadSchema = z
  .object({
    fileId: z.string().trim().min(1).max(160),
    conversationId: conversationIdSchema,
    title: z.string().trim().min(1).max(240),
    mimeType: z.string().max(128),
    version: z.int().positive(),
  })
  .strict();
export const artifactIdsSchema = z
  .array(z.string().trim().min(1).max(160))
  .max(12)
  .default([]);

/** Resolve references from the caller's visible files; never copy a private channel's work into another channel. */
export function artifactMessageComponents(
  rawIds: JsonValue | undefined,
  files: readonly WorkspaceFile[],
  conversationId: string,
) {
  return [...new Set(artifactIdsSchema.parse(rawIds))].map((id, index) => {
    const file = files.find(
      (file) => file.id === id && file.conversationId === conversationId,
    );
    if (!file)
      throw new z.ZodError([
        {
          code: "custom",
          path: ["artifactIds"],
          message:
            "Artifact not found in this channel. Create or publish the file in this channel first.",
        },
      ]);
    return {
      id: `artifact-${index}-${id}`.slice(0, 128),
      kind: "artifact.reference",
      version: 1,
      payload: artifactReferencePayloadSchema.parse({
        fileId: file.id,
        conversationId: file.conversationId,
        title: file.title,
        mimeType: file.mimeType,
        version: file.version,
      }),
    };
  });
}

export function channelArtifactPath(conversationId: string, fileId: string) {
  return `/conversations?${new URLSearchParams({ channel: conversationId, view: "canvas", artifact: fileId })}`;
}
