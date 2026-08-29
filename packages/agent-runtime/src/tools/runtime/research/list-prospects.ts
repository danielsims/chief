import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { listProspectsDefinition } from "../../toolkits/research/list-prospects.js";

export const listProspectsTool = defineLocalTool({
  ...listProspectsDefinition,
  async execute({ manager, workspaceId }) {
    const data = await manager.workspaceData(workspaceId);
    return jsonResponse({ prospects: data.prospects });
  },
});
