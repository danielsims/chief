import { routeRelayRequest } from "./router";

export { WorkspaceServiceProxy } from "@cloudflare/computer";

export { AgentObject } from "./agent-object";
export { AccountObject } from "./account-object";
export { AnalyticsObject } from "./analytics-object";
export { ConversationObject } from "./conversation-object";
export { WorkspaceObject } from "./workspace-object";

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    return routeRelayRequest(request, env, context);
  },
} satisfies ExportedHandler<Env>;
