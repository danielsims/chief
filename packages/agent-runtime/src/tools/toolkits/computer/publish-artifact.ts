import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";
import { computerPathSchema } from "./input.js";

export const computerPublishArtifactDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/computer/artifacts",
  operation: {
    operationId: "computer.artifacts.publish",
    summary: "Publish an agent computer file as a Chief artifact",
  },
  inputSchema: z.object({
    path: computerPathSchema,
    name: boundedText(240),
    contentType: boundedText(160),
  }),
});
