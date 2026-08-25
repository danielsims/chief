import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { computerGitDefinition } from "../../toolkits/computer/git.js";
import {
  boundedComputerOutput,
  requireComputer,
} from "../../toolkits/computer/input.js";

export const computerGitTool = defineLocalTool({
  ...computerGitDefinition,
  async execute({ context, input }) {
    const result = await requireComputer(context).git(input.argv, input.cwd);
    return jsonResponse({
      exitCode: result.exitCode,
      stdout: boundedComputerOutput(result.stdout),
      stderr: boundedComputerOutput(result.stderr),
    });
  },
});
