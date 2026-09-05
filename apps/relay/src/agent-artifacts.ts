import type { AgentComputer } from "@chief/agent-computer";
import type {
  AgentPrincipal,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import { workspaceFileSchema } from "@chief/relay-contracts";

import { HttpError, relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { saveWorkspaceMedia } from "./workspace-media";

const MAX_AGENT_ARTIFACT_BYTES = 8 * 1_024 * 1_024;

export async function publishAgentArtifact(
  computer: AgentComputer,
  env: Env,
  input: {
    principal: AgentPrincipal;
    conversationId: string;
    path: string;
    name: string;
    contentType: string;
  },
) {
  if (
    input.name.length > 240 ||
    !/^[\w.+-]+\/[\w.+-]+$/u.test(input.contentType)
  ) {
    throw new HttpError(
      400,
      "invalid_agent_artifact",
      "The artifact name or content type is invalid.",
    );
  }
  const content = await computer.readBytes(input.path);
  if (content.byteLength > MAX_AGENT_ARTIFACT_BYTES) {
    throw new HttpError(
      413,
      "agent_artifact_too_large",
      "Agent artifacts must be 8MB or smaller.",
    );
  }
  const file = await saveWorkspaceMedia(env, input.principal, {
    content,
    name: input.name,
    contentType: input.contentType,
    conversationId: input.conversationId,
  });
  const origin = new URL(env.AUTH_BASE_URL).origin;
  return {
    artifactId: file.id,
    fileId: file.id,
    name: file.title,
    contentType: file.mimeType,
    bytes: content.byteLength,
    url: `${origin}/v1/workspaces/${encodeURIComponent(input.principal.workspaceId)}/agents/${encodeURIComponent(input.principal.agentId)}/artifacts/${file.id}`,
  };
}

export async function getAgentArtifact(
  env: Env,
  principal: Principal,
  workspaceId: WorkspaceId,
  agentId: string,
  artifactId: string,
) {
  const metadata = await env.WORKSPACES.get(
    env.WORKSPACES.idFromName(workspaceId),
  ).fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "x-chief-internal-operation": "data-file-get",
          "x-chief-workspace-file-id": artifactId,
        },
      }),
      { principal, workspaceId, requestId: crypto.randomUUID() },
    ),
  );
  if (!metadata.ok) {
    await metadata.body?.cancel();
    return relayError(404, "artifact_not_found", "The artifact was not found.");
  }
  const file = workspaceFileSchema.parse(await metadata.json());
  if (file.asset?.agentId !== agentId || file.asset.artifactId !== artifactId)
    return relayError(404, "artifact_not_found", "The artifact was not found.");
  const object = await env.ARTIFACTS.get(
    artifactKey(workspaceId, agentId, artifactId),
  );
  if (!object) {
    return relayError(404, "artifact_not_found", "The artifact was not found.");
  }
  const contentType =
    object.httpMetadata?.contentType ??
    object.customMetadata?.contentType ??
    "application/octet-stream";
  const originalName = object.customMetadata?.name ?? "artifact";
  const name = safeFileName(originalName);
  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(originalName).replaceAll("'", "%27")}`,
      "cache-control": "private, no-store",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function artifactKey(workspaceId: string, agentId: string, artifactId: string) {
  return `${workspaceId}/agents/${agentId}/artifacts/${artifactId}`;
}

function safeFileName(value: string) {
  const safe = value.replace(/[^\x20-\x7e]|["\\]/gu, "_").trim();
  return safe || "artifact";
}
