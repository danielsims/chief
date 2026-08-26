import type { ConversationMessage } from "@chief/relay-contracts";
import { appendMessageResultSchema } from "@chief/relay-contracts";

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
  const workspaceResponse = await dispatchPersistedMessage(env, {
    ...input,
    message: result.message,
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
        }),
      }),
      input,
    ),
  );
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
