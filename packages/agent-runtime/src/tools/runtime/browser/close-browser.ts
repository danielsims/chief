import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { closeBrowserDefinition } from "../../toolkits/browser/close-browser.js";
import { localBrowserContextSchema } from "./input.js";

export const closeBrowserTool = defineLocalTool({
  ...closeBrowserDefinition,
  inputSchema: closeBrowserDefinition.inputSchema.and(
    localBrowserContextSchema,
  ),
  async execute({ context, input }) {
    if (!context.closeBrowser) {
      throw new Error("The embedded browser is unavailable.");
    }
    await context.closeBrowser(input.conversationId, input.browserRunId);
    return jsonResponse({ closed: true, browserRunId: input.browserRunId });
  },
});
