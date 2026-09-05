import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { listFilesDefinition } from "./definitions.js";

export const listFilesTool = defineLocalTool({
  ...listFilesDefinition,
  async execute({ manager, workspaceId }) {
    return jsonResponse({
      files: await manager.listWorkspaceFiles(workspaceId),
    });
  },
});
