import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";

export const readWebPageDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/web/read",
  operation: {
    operationId: "web.read",
    summary: "Read a public web page",
    description:
      "Fetches a public HTTP or HTTPS page and returns bounded readable text and links without opening an interactive browser. Use this for ordinary public research. Use browser tools only when interaction, authentication, screenshots, or user takeover is required.",
  },
  inputSchema: z.object({
    url: boundedText(2_000),
  }),
});
