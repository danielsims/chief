import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { computerPathSchema } from "./input.js";

export const computerListFilesDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/computer/list",
  operation: {
    operationId: "computer.list",
    summary: "List files in the agent computer",
  },
  inputSchema: z.object({ path: computerPathSchema }),
});
