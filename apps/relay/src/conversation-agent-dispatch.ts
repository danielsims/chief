import type { ConversationMessage } from "@chief/relay-contracts";
import {
  appendMessageResultSchema,
  messagePageSchema,
} from "@chief/relay-contracts";

import { withTrustedContext } from "./internal-context";

export async function dispatchAppendedMessage(
  env: Env,
  input: {
    request: Request;
    response: Response;
    principal: Parameters<typeof withTrustedContext>[1]["principal"];
    requestId: string;
    workspaceId: Parameters<typeof withTrustedContext>[1]["workspaceId"];
    conversationId: string;
  },
) {
  if (
    !input.response.ok ||
    !isMessageAppend(input.request, input.workspaceId, input.conversationId)
  ) {
    return input.response;
  }
  const result = appendMessageResultSchema.parse(
    await input.response.clone().json(),
  );
  const replyAgentId = result.message.threadRootId
    ? await threadOwner(env, {
        ...input,
        threadRootId: result.message.threadRootId,
      })
    : undefined;
  const workspaceResponse = await dispatchPersistedMessage(env, {
    ...input,
    message: result.message,
    ...(replyAgentId ? { replyAgentId } : undefined),
  });
  return workspaceResponse.ok ? input.response : workspaceResponse;
}

export function dispatchPersistedMessage(
  env: Env,
  input: {
    message: ConversationMessage;
    principal: Parameters<typeof withTrustedContext>[1]["principal"];
    requestId: string;
    workspaceId: Parameters<typeof withTrustedContext>[1]["workspaceId"];
    conversationId: string;
    workflowId?: string;
    replyAgentId?: string;
  },
) {
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(input.workspaceId)).fetch(
    withTrustedContext(
      new Request("https://workspace.internal/agent-message-dispatch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "agent-message-dispatch",
          "x-chief-workflow-id": input.workflowId ?? input.message.id,
        },
        body: JSON.stringify({
          message: input.message,
          workflowId: input.workflowId ?? input.message.id,
          ...(input.replyAgentId
            ? { replyAgentId: input.replyAgentId }
            : undefined),
        }),
      }),
      input,
    ),
  );
}

async function threadOwner(
  env: Env,
  input: {
    principal: Parameters<typeof withTrustedContext>[1]["principal"];
    requestId: string;
    workspaceId: Parameters<typeof withTrustedContext>[1]["workspaceId"];
    conversationId: string;
    threadRootId: string;
  },
) {
  const url = new URL("https://conversation.internal/messages");
  url.searchParams.set("threadRootId", input.threadRootId);
  url.searchParams.set("limit", "100");
  const response = await env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(
      `${input.workspaceId}:${input.conversationId}`,
    ),
  ).fetch(
    withTrustedContext(
      new Request(url, {
        headers: { "x-chief-internal-operation": "agent-history" },
      }),
      input,
    ),
  );
  if (!response.ok) return undefined;
  const page = messagePageSchema.parse(await response.json());
  const root = page.messages.find(
    (message) => message.id === input.threadRootId,
  );
  if (!root) return undefined;
  if (root.author.kind === "agent") return root.author.id;
  return root.mentions[0];
}

function isMessageAppend(
  request: Request,
  workspaceId: string,
  conversationId: string,
) {
  return (
    request.method === "POST" &&
    new URL(request.url).pathname ===
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages`
  );
}
