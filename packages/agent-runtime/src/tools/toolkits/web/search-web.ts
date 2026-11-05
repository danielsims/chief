import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";

export const searchWebDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/web/search",
  operation: {
    operationId: "web.search",
    summary: "Search the web",
    description:
      "Search Google in the interactive browser and return its rendered page and link controls. Follow relevant results with browser tools or web_read. A verification_required response needs the user to complete Google verification; never silently change engines or retry the challenge in a loop.",
  },
  inputSchema: z.object({
    query: boundedText(400),
  }),
});
