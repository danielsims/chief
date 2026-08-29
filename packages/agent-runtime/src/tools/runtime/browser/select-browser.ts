import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { commandLabels } from "../../toolkits/browser/input.js";
import { selectBrowserDefinition } from "../../toolkits/browser/select-browser.js";
import { localBrowserContextSchema } from "./input.js";

export const selectBrowserTool = defineLocalTool({
  ...selectBrowserDefinition,
  inputSchema: selectBrowserDefinition.inputSchema.and(
    localBrowserContextSchema,
  ),
  async execute({ context, input }) {
    if (!context.browserCommand) {
      throw new Error("The embedded browser is unavailable.");
    }
    return jsonResponse(
      await context.browserCommand(
        input.conversationId,
        {
          type: "select",
          labels: commandLabels(input),
          values: input.values,
        },
        input.browserRunId,
      ),
    );
  },
});
