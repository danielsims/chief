import { z } from "zod";

import { writeWorkspaceBrandProfile } from "../../../../workspace-context.js";
import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const brandProfileInputSchema = z.object({
  markdown: boundedText(20_000).pipe(z.string().min(100)),
});

export const saveBrandProfileTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/brand-profile",
  operation: {
    operationId: "brandProfile.save",
    summary: "Save the workspace brand profile",
    description:
      "Stores researched or user-supplied context for future agent sessions.",
  },
  inputSchema: brandProfileInputSchema,
  execute({ input, workspaceId }) {
    writeWorkspaceBrandProfile(workspaceId, input.markdown);
    return jsonResponse({ saved: true });
  },
});
