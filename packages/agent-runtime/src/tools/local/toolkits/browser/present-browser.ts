import { z } from "zod";

import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { browserTargetFields } from "./input.js";

const presentBrowserInputSchema = z.object({
  ...browserTargetFields,
  mode: z.enum(["inline", "picture-in-picture"]),
});

export const presentBrowserTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/browser/present",
  operation: {
    operationId: "browser.present",
    summary: "Change the embedded browser presentation",
    description:
      "Keeps the browser inline by default. Use picture-in-picture only when the user asks to snap or minimize the live browser, or when an explicit handoff calls for it.",
  },
  inputSchema: presentBrowserInputSchema,
  async execute({ context, input }) {
    if (!context.presentBrowser) {
      throw new Error("The embedded browser is unavailable.");
    }
    await context.presentBrowser(
      input.conversationId,
      input.mode,
      input.browserRunId,
    );
    return jsonResponse({ mode: input.mode, browserRunId: input.browserRunId });
  },
});
