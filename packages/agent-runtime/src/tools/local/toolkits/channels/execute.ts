import type { JsonObject } from "@chief/relay-contracts";
import { toJsonObject } from "@chief/relay-contracts";

import type { LocalToolRequest } from "../../tool.js";
import { handleChannelLocalTool } from "../../../../channel-local-tools.js";
import { jsonResponse } from "../../response.js";

export async function executeChannelTool<Input>(
  request: LocalToolRequest,
  input?: Input,
) {
  const channels = request.context.channels;
  if (!channels) {
    return jsonResponse(
      {
        error: "Channel management is unavailable.",
        code: "channel_api_unavailable",
      },
      503,
    );
  }
  const body: JsonObject = input ? toJsonObject(input) : request.body;
  const result = await handleChannelLocalTool(
    request.request,
    request.workspaceId,
    body,
    { ...channels, plugins: request.context.plugins },
  );
  if (!result.handled) throw new Error("Unknown channel operation.");
  return jsonResponse(result.value, result.status);
}
