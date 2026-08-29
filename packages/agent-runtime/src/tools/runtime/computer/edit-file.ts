import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { computerEditFileDefinition } from "../../toolkits/computer/edit-file.js";
import { requireComputer } from "../../toolkits/computer/input.js";

export const computerEditFileTool = defineLocalTool({
  ...computerEditFileDefinition,
  async execute({ context, input }) {
    return jsonResponse({
      ok: true,
      path: input.path,
      ...(await requireComputer(context).editText(
        input.path,
        input.oldText,
        input.newText,
        input.replaceAll,
      )),
    });
  },
});
