import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";
import { computerPathSchema } from "./input.js";

export const computerExecuteCommandDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/computer/execute",
  operation: {
    operationId: "computer.execute",
    summary: "Run a bounded command on the agent computer",
    description:
      "Runs through the active AgentComputer adapter, so available commands depend on the deployment target.",
  },
  inputSchema: z.object({
    command: boundedText(20_000),
    cwd: computerPathSchema.optional(),
  }),
});
