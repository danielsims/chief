import { routeRelayRequest } from "./router";

export { AgentObject } from "./agent-object";
export { AccountObject } from "./account-object";
export { ConversationObject } from "./conversation-object";
export { WorkspaceObject } from "./workspace-object";

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    return routeRelayRequest(request, env, context);
  },
} satisfies ExportedHandler<Env>;
