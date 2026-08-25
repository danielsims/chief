import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { presentBrowserDefinition } from "../../toolkits/browser/present-browser.js";
import { localBrowserContextSchema } from "./input.js";

export const presentBrowserTool = defineLocalTool({
  ...presentBrowserDefinition,
  inputSchema: presentBrowserDefinition.inputSchema.and(
    localBrowserContextSchema,
  ),
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
