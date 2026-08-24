import type { JsonObject } from "@chief/relay-contracts";
import { toJsonObject } from "@chief/relay-contracts";

import type { LocalToolRequest } from "../../tool.js";
import { handleScheduledWorkLocalTool } from "../../../../scheduled-work-local-tools.js";
import { jsonResponse } from "../../response.js";

export async function executeScheduledWorkTool<Input>(
  request: LocalToolRequest,
  input?: Input,
) {
  const body: JsonObject = input ? toJsonObject(input) : request.body;
  const result = await handleScheduledWorkLocalTool({
    request: request.request,
    workspaceId: request.workspaceId,
    body,
    manager: request.manager,
    runner: request.context.scheduledWork,
    conversationId: request.context.conversationId,
    origin: new URL(request.request.url).origin,
  });
  if (!result.handled) throw new Error("Unknown scheduled work operation.");
  return jsonResponse(result.value, result.status);
}
