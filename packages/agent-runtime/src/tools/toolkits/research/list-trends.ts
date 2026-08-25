import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const listTrendsTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/trends",
  operation: {
    operationId: "trends.list",
    summary: "List saved research trends",
  },
  async execute({ manager, workspaceId }) {
    const data = await manager.workspaceData(workspaceId);
    return jsonResponse({ trends: data.trends });
  },
});
