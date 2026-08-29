import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { requireComputer } from "../../toolkits/computer/input.js";
import { computerListFilesDefinition } from "../../toolkits/computer/list-files.js";

export const computerListFilesTool = defineLocalTool({
  ...computerListFilesDefinition,
  async execute({ context, input }) {
    return jsonResponse({
      path: input.path,
      entries: (await requireComputer(context).list(input.path)).slice(0, 500),
    });
  },
});
