import { z } from "zod";

import { defineAgentTool } from "../../definition.js";

const presentBrowserInputSchema = z.object({
  mode: z.enum(["inline", "picture-in-picture"]),
});

export const presentBrowserDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/browser/present",
  operation: {
    operationId: "browser.present",
    summary: "Change the embedded browser presentation",
    description:
      "Keeps the browser inline by default. Use picture-in-picture only when the user asks to snap or minimize the live browser, or when an explicit handoff calls for it.",
  },
  inputSchema: presentBrowserInputSchema,
});
