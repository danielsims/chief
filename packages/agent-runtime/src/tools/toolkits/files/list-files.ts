import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const listFilesTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/files",
  operation: {
    operationId: "files.list",
    summary: "List editable workspace files",
    description:
      "Returns file ids, workspace-relative paths, types and current revision ids without loading every file body.",
  },
  async execute({ manager, workspaceId }) {
    return jsonResponse({
      files: await manager.listWorkspaceFiles(workspaceId),
    });
  },
});
