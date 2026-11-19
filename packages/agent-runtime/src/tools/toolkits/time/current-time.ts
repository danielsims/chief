import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { optionalBoundedText } from "../../input.js";

export const currentTimeDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/time/now",
  operation: {
    operationId: "time.now",
    summary: "Current date and time",
    description:
      "Returns the current time in UTC and in the time zone of the person you're working for, when known. Pass an IANA timeZone such as America/New_York to also get the time there. Use this instead of looking the time up on the web.",
  },
  inputSchema: z.object({
    timeZone: optionalBoundedText(64),
  }),
});
