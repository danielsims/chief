import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { requireComputer } from "../../toolkits/computer/input.js";
import { computerWriteFileDefinition } from "../../toolkits/computer/write-file.js";

export const computerWriteFileTool = defineLocalTool({
  ...computerWriteFileDefinition,
  async execute({ context, input }) {
    await requireComputer(context).writeText(input.path, input.content);
    return jsonResponse({
      ok: true,
      path: input.path,
      bytesWritten: new TextEncoder().encode(input.content).length,
    });
  },
});
