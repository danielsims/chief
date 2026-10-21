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
      "Searches the public web and returns titles, URLs and snippets. Find pages with this, then read the ones that matter with web_read. Never search by reading search engine or map URLs with web_read or the browser.",
  },
  inputSchema: z.object({
    query: boundedText(400),
  }),
});
