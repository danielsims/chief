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
      "Search the web and return the top results with their content. Describe the page you want rather than listing keywords. Follow promising result URLs with web_read or the browser. A verification_required response came from Google in a lent browser and needs the user to complete it; do not retry it in a loop.",
  },
  inputSchema: z.object({
    query: boundedText(400),
  }),
});
