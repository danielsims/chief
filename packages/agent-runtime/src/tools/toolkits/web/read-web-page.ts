import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";

export const readWebPageDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/web/read",
  operation: {
    operationId: "web.read",
    summary: "Read web page",
    description:
      "Reads a public HTTP or HTTPS page and returns bounded readable text and links. Nothing is shown to the user. Use this whenever you only need to know what a page says.",
  },
  inputSchema: z.object({
    url: boundedText(2_000),
  }),
});
