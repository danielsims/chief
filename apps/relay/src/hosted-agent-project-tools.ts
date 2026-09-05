import type { AgentJob, JsonObject } from "@chief/relay-contracts";
import { isJsonString } from "@chief/relay-contracts";

import { publishAgentMessage } from "./agent-message-publisher";
import { hostedPluginPlacement } from "./hosted-agent-plugin-tools";

export async function executeHostedAgentProjectTool(
  env: Env,
  job: AgentJob,
  name: string,
  input: JsonObject,
) {
  if (name !== "projects.recommend") {
    throw new Error(`Unsupported project tool operation: ${name}`);
  }
  const { conversationId, threadRootId } = hostedPluginPlacement(
    job.payload,
    input,
  );
  const idempotencyKey = requiredString(input, "idempotencyKey");
  const remoteUrl = optionalUrl(input.remoteUrl);
  await publishAgentMessage(
    env,
    job,
    {
      conversationId,
      ...(threadRootId ? { threadRootId } : undefined),
      body: requiredString(input, "content"),
      components: [
        {
          id: await deterministicUuid(`${job.id}:${idempotencyKey}:project`),
          kind: "project.recommendation",
          version: 1,
          payload: {
            workspaceId: job.workspaceId,
            conversationId,
            ...(threadRootId ? { threadRootId } : undefined),
            agentId: job.agentId,
            title: "Connect a repository",
            description:
              "Add the Git repository this workspace should work in.",
            ...(remoteUrl ? { remoteUrl } : undefined),
          },
        },
      ],
    },
    await deterministicUuid(`${job.id}:${name}:${idempotencyKey}`),
  );
  return { ok: true, conversationId };
}

function requiredString(input: JsonObject, key: string) {
  const value = input[key];
  if (!isJsonString(value) || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalUrl(value: unknown) {
  if (!isJsonString(value) || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
