import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { computerExecuteCommandDefinition } from "../../toolkits/computer/execute-command.js";
import {
  boundedComputerOutput,
  requireComputer,
} from "../../toolkits/computer/input.js";

export const computerExecuteCommandTool = defineLocalTool({
  ...computerExecuteCommandDefinition,
  async execute({ context, input }) {
    const result = await requireComputer(context).execute(
      input.command,
      input.cwd,
    );
    return jsonResponse({
      exitCode: result.exitCode,
      stdout: boundedComputerOutput(result.stdout),
      stderr: boundedComputerOutput(result.stderr),
    });
  },
});
