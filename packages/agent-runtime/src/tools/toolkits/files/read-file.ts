import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const readFileInputSchema = z.object({ fileId: boundedText(120) });

export const readFileTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/files/read",
  operation: {
    operationId: "files.read",
    summary: "Read an editable workspace file",
  },
  inputSchema: readFileInputSchema,
  async execute({ input, manager, workspaceId }) {
    const file = await manager.workspaceFile(workspaceId, input.fileId);
    return file
      ? jsonResponse({ file })
      : jsonResponse({ error: "File not found." }, 404);
  },
});
