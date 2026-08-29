import { createNip98Authorization, RelayClient } from "@chief/relay-client";

export interface RelayCellContext {
  client: RelayClient;
  workspaceId: string;
  agentId: string;
  conversationId: string;
  threadRootId?: string;
}

export function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionalEnvironment(name: string) {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}

export function relayCellContext(): RelayCellContext {
  const workspaceId = requiredEnvironment("CHIEF_WORKSPACE_ID");
  const secretKey = requiredEnvironment("CHIEF_AGENT_SECRET_KEY");
  return {
    workspaceId,
    agentId: requiredEnvironment("CHIEF_AGENT_ID"),
    conversationId: requiredEnvironment("CHIEF_CONVERSATION_ID"),
    threadRootId: optionalEnvironment("CHIEF_THREAD_ROOT_ID"),
    client: new RelayClient({
      relayUrl: requiredEnvironment("CHIEF_RELAY_URL"),
      workspaceId,
      getAuthorization: (request) =>
        Promise.resolve(createNip98Authorization(secretKey, request)),
    }),
  };
}
