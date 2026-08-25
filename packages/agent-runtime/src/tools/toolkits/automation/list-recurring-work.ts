import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const listRecurringWorkTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/recurring-work",
  operation: {
    operationId: "recurringWork.list",
    summary: "List recurring agent work and approval state",
  },
  async execute({ manager, workspaceId }) {
    const data = await manager.workspaceData(workspaceId);
    return jsonResponse({ recurringWork: data.recurringWork });
  },
});
