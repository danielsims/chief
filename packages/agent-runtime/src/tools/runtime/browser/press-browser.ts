import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { pressBrowserDefinition } from "../../toolkits/browser/press-browser.js";
import { localBrowserContextSchema } from "./input.js";

export const pressBrowserTool = defineLocalTool({
  ...pressBrowserDefinition,
  inputSchema: pressBrowserDefinition.inputSchema.and(
    localBrowserContextSchema,
  ),
  async execute({ context, input }) {
    if (!context.browserCommand) {
      throw new Error("The embedded browser is unavailable.");
    }
    return jsonResponse(
      await context.browserCommand(
        input.conversationId,
        { type: "press", key: input.key },
        input.browserRunId,
      ),
    );
  },
});
