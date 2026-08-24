import { z } from "zod";

import { optionalBoundedText } from "../../input.js";
import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";

const listChannelsQuerySchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  query: optionalBoundedText(120),
});

export const listChannelsTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/channels",
  operation: {
    operationId: "channels.list",
    summary: "List workspace channels",
  },
  querySchema: listChannelsQuerySchema,
  execute: executeChannelTool,
});
