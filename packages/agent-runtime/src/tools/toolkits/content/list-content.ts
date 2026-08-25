import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const listContentTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/content",
  operation: {
    operationId: "content.list",
    summary: "List drafts and scheduled content",
  },
  async execute({ manager, workspaceId }) {
    const data = await manager.workspaceData(workspaceId);
    return jsonResponse({ drafts: data.drafts });
  },
});
