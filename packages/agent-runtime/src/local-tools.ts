import { parseJsonObject } from "@chief/relay-contracts";

import type { LocalToolContext } from "./local-tool-context.js";
import type { SessionManager } from "./manager.js";
import { workspaceToolRouter } from "./tools/index.js";
import { jsonResponse } from "./tools/response.js";

export { localToolsOpenApi } from "./local-tools-openapi.js";

export type { LocalToolContext } from "./local-tool-context.js";

async function requestBody(request: Request) {
  if (request.method === "GET") return {};
  const value: unknown = await request
    .clone()
    .json()
    .catch(() => ({}));
  return parseJsonObject(value) ?? {};
}

export async function handleLocalTool(
  request: Request,
  workspaceId: string,
  manager: SessionManager,
  context: LocalToolContext = {},
) {
  const body = await requestBody(request);
  try {
    const toolResult = await workspaceToolRouter.execute({
      request,
      body,
      workspaceId,
      manager,
      context,
    });
    if (toolResult) return toolResult;
    return jsonResponse({ error: "Not found" }, 404);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
}
