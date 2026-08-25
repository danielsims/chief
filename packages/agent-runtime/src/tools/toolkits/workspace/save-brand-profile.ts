import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";

export const saveBrandProfileDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/brand-profile",
  operation: {
    operationId: "brandProfile.save",
    summary: "Save the workspace brand profile",
    description:
      "Stores researched or user-supplied context for future agent sessions.",
  },
  inputSchema: z.object({
    markdown: boundedText(20_000).pipe(z.string().min(100)),
    sourceUrls: z.array(z.string().url()).max(50).default([]),
  }),
});
