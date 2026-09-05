import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";
import { computerPathSchema } from "./input.js";

export const computerPublishArtifactDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/computer/artifacts",
  operation: {
    operationId: "computer.artifacts.publish",
    description:
      "Publish an existing file up to 8 MB. Use a /workspace-relative path, a filename with its extension, and the matching MIME type. The output persists in Files and can be previewed or downloaded by workspace members.",
    summary:
      "Save an image, video, audio, PDF, or other file to the workspace Files library",
  },
  inputSchema: z.object({
    path: computerPathSchema,
    name: boundedText(240),
    contentType: boundedText(160),
  }),
});
