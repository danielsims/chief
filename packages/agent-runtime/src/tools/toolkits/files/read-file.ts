import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { readFileDefinition } from "./definitions.js";

export const readFileTool = defineLocalTool({
  ...readFileDefinition,
  async execute({ input, manager, workspaceId }) {
    const file = await manager.workspaceFile(workspaceId, input.fileId);
    return file
      ? jsonResponse({ file })
      : jsonResponse({ error: "File not found." }, 404);
  },
});
