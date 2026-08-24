import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const listProspectsTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/prospects",
  operation: {
    operationId: "prospects.list",
    summary: "List saved prospects",
  },
  async execute({ manager, workspaceId }) {
    const data = await manager.workspaceData(workspaceId);
    return jsonResponse({ prospects: data.prospects });
  },
});
