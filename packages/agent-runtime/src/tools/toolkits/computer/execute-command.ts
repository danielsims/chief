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
      "Runs in the agent's persistent /workspace through the active AgentComputer adapter. To show a locally served page, bind it to localhost on a port other than the reserved control port 8080, then open that URL with browser.open.",
  },
  inputSchema: z.object({
    command: boundedText(20_000),
    cwd: computerPathSchema.optional(),
  }),
});
