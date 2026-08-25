import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { clickBrowserDefinition } from "../../toolkits/browser/click-browser.js";
import { commandLabels } from "../../toolkits/browser/input.js";
import { localBrowserContextSchema } from "./input.js";

export const clickBrowserTool = defineLocalTool({
  ...clickBrowserDefinition,
  inputSchema: clickBrowserDefinition.inputSchema.and(
    localBrowserContextSchema,
  ),
  async execute({ context, input }) {
    if (!context.browserCommand)
      throw new Error("The embedded browser is unavailable.");
    return jsonResponse(
      await context.browserCommand(
        input.conversationId,
        { type: "click", labels: commandLabels(input) },
        input.browserRunId,
      ),
    );
  },
});
