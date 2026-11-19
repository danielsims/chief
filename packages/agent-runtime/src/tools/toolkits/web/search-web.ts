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
      "Searches Google in a background browser nobody is shown and returns the results page and its links. Read results with web_read. A verification_required response needs the user to complete Google verification; never silently change engines or retry the challenge in a loop.",
  },
  inputSchema: z.object({
    query: boundedText(400),
  }),
});
