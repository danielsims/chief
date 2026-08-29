import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { computerPathSchema } from "./input.js";

export const computerEditFileDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/computer/edit",
  operation: {
    operationId: "computer.edit",
    summary: "Replace exact text in an agent computer file",
  },
  inputSchema: z.object({
    path: computerPathSchema,
    oldText: z.string().min(1).max(200_000),
    newText: z.string().max(200_000),
    replaceAll: z.boolean().default(false),
  }),
});
