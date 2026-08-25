import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const listCampaignsTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/campaigns",
  operation: {
    operationId: "campaigns.list",
    summary: "List saved paid campaigns",
  },
  async execute({ manager, workspaceId }) {
    const data = await manager.workspaceData(workspaceId);
    return jsonResponse({ campaigns: data.campaigns });
  },
});
