import type { AgentComputer } from "@chief/agent-computer";

import { HttpError, relayError } from "./http";

const MAX_AGENT_ARTIFACT_BYTES = 8 * 1_024 * 1_024;

export async function publishAgentArtifact(
  computer: AgentComputer,
  env: Env,
  input: {
    workspaceId: string;
    agentId: string;
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
  const artifactId = crypto.randomUUID();
  const key = artifactKey(input.workspaceId, input.agentId, artifactId);
  await env.ARTIFACTS.put(key, content, {
    customMetadata: {
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      name: input.name,
      contentType: input.contentType,
    },
    httpMetadata: { contentType: input.contentType },
  });
  const origin = new URL(env.AUTH_BASE_URL).origin;
  return {
    artifactId,
    name: input.name,
    contentType: input.contentType,
    bytes: content.byteLength,
    url: `${origin}/v1/workspaces/${encodeURIComponent(input.workspaceId)}/agents/${encodeURIComponent(input.agentId)}/artifacts/${artifactId}`,
  };
}

export async function getAgentArtifact(
  env: Env,
  workspaceId: string,
  agentId: string,
  artifactId: string,
) {
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
  const name = safeFileName(object.customMetadata?.name ?? "artifact");
  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "private, max-age=300",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function artifactKey(workspaceId: string, agentId: string, artifactId: string) {
  return `${workspaceId}/agents/${agentId}/artifacts/${artifactId}`;
}

function safeFileName(value: string) {
  const safe = value.replace(/["\\\r\n]/gu, "_").trim();
  return safe || "artifact";
}
