import type {
  JsonObject,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";

import { withTrustedContext } from "./internal-context";
import { requireInternalResponse } from "./internal-response";

export function publishConversationWorkspaceEvent(
  context: DurableObjectState,
  env: Env,
  event: JsonObject,
  principal: Principal,
  workspaceId: WorkspaceId,
  conversationId: string,
  requestId: string,
) {
  const workspace = env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId));
  context.waitUntil(
    workspace
      .fetch(
        withTrustedContext(
          new Request("https://workspace.internal/live-events", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-chief-internal-operation": "live-event-publish",
            },
            body: JSON.stringify(event),
          }),
          {
            principal,
            requestId,
            workspaceId,
            conversationId,
          },
        ),
      )
      .then((response) =>
        requireInternalResponse(
          response,
          "Workspace live event publication failed.",
        ),
      ),
  );
}
