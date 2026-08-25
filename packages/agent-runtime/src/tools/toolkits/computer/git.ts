import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";
import { computerPathSchema } from "./input.js";

export const computerGitDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/computer/git",
  operation: {
    operationId: "computer.git",
    summary: "Run Git against the agent computer repository",
  },
  inputSchema: z.object({
    argv: z.array(boundedText(2_000)).min(1).max(128),
    cwd: computerPathSchema.optional(),
  }),
});
