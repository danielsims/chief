import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { computerPathSchema } from "./input.js";

export const computerWriteFileDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/computer/write",
  operation: {
    operationId: "computer.write",
    summary: "Write a complete UTF-8 file in the agent computer",
  },
  inputSchema: z.object({
    path: computerPathSchema,
    content: z.string().max(1_000_000),
  }),
});
