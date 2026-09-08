import type { AgentPrincipal } from "@chief/relay-contracts";
import {
  workspaceFileSchema,
  workspaceMediaUploadSchema,
} from "@chief/relay-contracts";

import { HttpError, parseJson } from "./http";
import { withTrustedContext } from "./internal-context";

export const MAX_WORKSPACE_MEDIA_BYTES = 8 * 1024 * 1024;

export async function saveWorkspaceMedia(
  env: Env,
  principal: AgentPrincipal,
  input: {
    name: string;
    contentType: string;
    conversationId: string;
    content: Uint8Array;
  },
) {
  if (input.content.byteLength > MAX_WORKSPACE_MEDIA_BYTES) {
    throw new HttpError(
      413,
      "workspace_media_too_large",
      "Files must be 8 MB or smaller.",
    );
  }
  const artifactId = crypto.randomUUID();
  const key = `${principal.workspaceId}/agents/${principal.agentId}/artifacts/${artifactId}`;
  await env.ARTIFACTS.put(key, input.content, {
    customMetadata: {
      workspaceId: principal.workspaceId,
      agentId: principal.agentId,
      name: input.name,
      contentType: input.contentType,
    },
    httpMetadata: { contentType: input.contentType },
  });
  try {
    const response = await env.WORKSPACES.get(
      env.WORKSPACES.idFromName(principal.workspaceId),
    ).fetch(
      withTrustedContext(
        new Request("https://workspace.internal", {
          method: "POST",
          headers: {
            "x-chief-internal-operation": "data-file-asset-save",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            id: artifactId,
            path: `media/${artifactId}/${input.name.replace(/[^\w. -]/gu, "_")}`,
            title: input.name,
            mimeType: input.contentType,
            content: "",
            conversationId: input.conversationId,
            asset: {
              artifactId,
              agentId: principal.agentId,
              bytes: input.content.byteLength,
            },
          }),
        }),
        {
          principal,
          requestId: crypto.randomUUID(),
          workspaceId: principal.workspaceId,
        },
      ),
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(
        response.status,
        "workspace_media_save_failed",
        "The file could not be added to this workspace.",
      );
    }
    return workspaceFileSchema.parse(await response.json());
  } catch (error) {
    await env.ARTIFACTS.delete(key);
    throw error;
  }
}

export async function parseWorkspaceMediaUpload(request: Request) {
  // Reject oversized streams before JSON parsing or base64 decoding allocates another copy.
  if (!request.body)
    throw new HttpError(400, "missing_upload", "A file is required.");
  const reader: ReadableStreamDefaultReader<unknown> = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    if (!(next.value instanceof Uint8Array))
      throw new HttpError(
        400,
        "invalid_upload",
        "Expected binary upload data.",
      );
    bytes += next.value.byteLength;
    if (bytes > 11_190_000) {
      await reader.cancel();
      throw new HttpError(
        413,
        "workspace_media_too_large",
        "Files must be 8 MB or smaller.",
      );
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const input = workspaceMediaUploadSchema.parse(
    await parseJson(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body,
      }),
    ),
  );
  const decoded = atob(input.contentBase64);
  const content = Uint8Array.from(decoded, (character) =>
    character.charCodeAt(0),
  );
  return {
    name: input.name,
    contentType: input.contentType,
    conversationId: input.conversationId,
    content,
  };
}
