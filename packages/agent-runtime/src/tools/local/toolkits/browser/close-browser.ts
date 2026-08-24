import { z } from "zod";

import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { browserTargetFields } from "./input.js";

const closeBrowserInputSchema = z.object(browserTargetFields);

export const closeBrowserTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/browser/close",
  operation: {
    operationId: "browser.close",
    summary: "Close Chief's embedded browser",
    description:
      "Ends the current embedded browser run after its work is genuinely finished. Never close a browser after handing it to the user for sign-in, consent, MFA, or another human action.",
  },
  inputSchema: closeBrowserInputSchema,
  async execute({ context, input }) {
    if (!context.closeBrowser) {
      throw new Error("The embedded browser is unavailable.");
    }
    await context.closeBrowser(input.conversationId, input.browserRunId);
    return jsonResponse({ closed: true, browserRunId: input.browserRunId });
  },
});
