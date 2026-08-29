import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { fillBrowserDefinition } from "../../toolkits/browser/fill-browser.js";
import { commandLabels } from "../../toolkits/browser/input.js";
import { localBrowserContextSchema } from "./input.js";

export const fillBrowserTool = defineLocalTool({
  ...fillBrowserDefinition,
  inputSchema: fillBrowserDefinition.inputSchema.and(localBrowserContextSchema),
  async execute({ context, input }) {
    if (!context.browserCommand)
      throw new Error("The embedded browser is unavailable.");
    return jsonResponse(
      await context.browserCommand(
        input.conversationId,
        { type: "fill", labels: commandLabels(input), value: input.value },
        input.browserRunId,
      ),
    );
  },
});
