import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { openBrowserDefinition } from "../../toolkits/browser/open-browser.js";
import { localBrowserContextSchema } from "./input.js";

export const openBrowserTool = defineLocalTool({
  ...openBrowserDefinition,
  inputSchema: openBrowserDefinition.inputSchema.and(localBrowserContextSchema),
  async execute({ context, input }) {
    if (!context.openBrowser)
      throw new Error("The embedded browser is unavailable.");
    const browserRunId = await context.openBrowser(
      input.conversationId,
      input.url,
      input.fresh,
      input.browserRunId,
    );
    return jsonResponse({
      opened: true,
      fresh: input.fresh,
      url: input.url,
      browserRunId,
    });
  },
});
