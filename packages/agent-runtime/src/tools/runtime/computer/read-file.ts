import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import {
  boundedComputerOutput,
  requireComputer,
} from "../../toolkits/computer/input.js";
import { computerReadFileDefinition } from "../../toolkits/computer/read-file.js";

export const computerReadFileTool = defineLocalTool({
  ...computerReadFileDefinition,
  async execute({ context, input }) {
    return jsonResponse({
      path: input.path,
      content: boundedComputerOutput(
        await requireComputer(context).readText(input.path),
      ),
    });
  },
});
