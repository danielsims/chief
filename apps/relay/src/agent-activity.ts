import type {
  AgentActivityComponent,
  AgentPrincipal,
} from "@chief/relay-contracts";
import { upsertAgentActivityPayloadSchema } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";

export async function publishAgentActivity(
  env: Env,
  input: {
    principal: AgentPrincipal;
    conversationId: string;
    threadRootId?: string;
    seed: string;
    component: Omit<AgentActivityComponent, "id">;
  },
) {
  const messageId = await deterministicUuid(`${input.seed}:message`);
  const payload = upsertAgentActivityPayloadSchema.parse({
    messageId,
    conversationId: input.conversationId,
    ...(input.threadRootId ? { threadRootId: input.threadRootId } : undefined),
    component: {
      ...input.component,
      id: await deterministicUuid(`${input.seed}:component`),
    },
  });
  const response = await env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(
      `${input.principal.workspaceId}:${input.conversationId}`,
    ),
  ).fetch(
    withTrustedContext(
      new Request(
        `https://conversation.internal/messages/${encodeURIComponent(messageId)}/activity`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      ),
      {
        principal: input.principal,
        requestId: messageId,
        workspaceId: input.principal.workspaceId,
        conversationId: input.conversationId,
      },
    ),
  );
  const published = response.ok;
  await releaseInternalResponse(response);
  if (!published) {
    throw new HttpError(
      502,
      "agent_activity_failed",
      "The addressed agent could not report its activity.",
    );
  }
}

export async function publishAgentErrorActivity(
  env: Env,
  input: {
    principal: AgentPrincipal;
    conversationId: string;
    threadRootId?: string;
    seed: string;
    code: string;
    title: string;
    message: string;
    jobId?: string;
    retryable?: boolean;
  },
) {
  await publishAgentActivity(env, {
    principal: input.principal,
    conversationId: input.conversationId,
    ...(input.threadRootId ? { threadRootId: input.threadRootId } : undefined),
    seed: input.seed,
    component: {
      kind: "error",
      version: 1,
      payload: {
        code: input.code,
        title: input.title,
        message: input.message,
        retryable: input.retryable ? "true" : "false",
        ...(input.jobId
          ? { jobId: input.jobId, runId: input.jobId }
          : undefined),
      },
    },
  });
}

async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
