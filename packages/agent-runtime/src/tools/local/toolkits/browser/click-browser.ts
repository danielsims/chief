import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { browserLabelsSchema, commandLabels } from "./input.js";

export const clickBrowserTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/browser/click",
  operation: {
    operationId: "browser.click",
    summary: "Click an agent-browser ref or visible control",
    description:
      "Clicks the first matching current agent-browser snapshot ref or semantic label and returns the refreshed page snapshot. Prefer the exact @ref from the latest snapshot, including for radio-style option cards.",
  },
  inputSchema: browserLabelsSchema,
  async execute({ context, input }) {
    if (!context.browserCommand) {
      throw new Error("The embedded browser is unavailable.");
    }
    return jsonResponse(
      await context.browserCommand(
        input.conversationId,
        { type: "click", labels: commandLabels(input) },
        input.browserRunId,
      ),
    );
  },
});
