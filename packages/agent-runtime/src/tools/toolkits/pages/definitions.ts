import { z } from "zod";

import { pageGuide } from "@chief/relay-contracts";

import { defineAgentTool } from "../../definition.js";
import { boundedText, optionalBoundedText } from "../../input.js";

/** Pages: artifacts built from Chief's components, showing live data. */
export const pageToolDefinitions = [
  defineAgentTool({
    method: "POST",
    path: "/local-tools/pages",
    operation: {
      operationId: "pages.save",
      summary: "Save page",
      description: `Create a page artifact in a channel, or replace one by its id: a dashboard, tracker or form over the channel's databases, which people open from the channel's Artifacts. Pages render in Chief, so describe them with these components rather than writing HTML. If saving fails, the error says what to fix.\n\n${pageGuide()}`,
    },
    inputSchema: z.object({
      id: optionalBoundedText(36),
      name: boundedText(160),
      channelId: optionalBoundedText(160),
      page: z.record(z.string(), z.unknown()),
    }),
  }),
];
