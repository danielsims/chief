import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { listRecurringWorkDefinition } from "./recurring-work-definitions.js";

export const listRecurringWorkTool = defineLocalTool({
  ...listRecurringWorkDefinition,
  async execute({ manager, workspaceId }) {
    const data = await manager.workspaceData(workspaceId);
    return jsonResponse({ recurringWork: data.recurringWork });
  },
});
