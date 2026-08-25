import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { computerPathSchema } from "./input.js";

export const computerReadFileDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/computer/read",
  operation: {
    operationId: "computer.read",
    summary: "Read a UTF-8 file from the agent computer",
  },
  inputSchema: z.object({ path: computerPathSchema }),
});
