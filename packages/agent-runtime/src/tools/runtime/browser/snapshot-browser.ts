import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { snapshotBrowserDefinition } from "../../toolkits/browser/snapshot-browser.js";
import { localBrowserContextSchema } from "./input.js";

export const snapshotBrowserTool = defineLocalTool({
  ...snapshotBrowserDefinition,
  inputSchema: snapshotBrowserDefinition.inputSchema.and(
    localBrowserContextSchema,
  ),
  async execute({ context, input }) {
    if (!context.browserCommand)
      throw new Error("The embedded browser is unavailable.");
    return jsonResponse(
      await context.browserCommand(
        input.conversationId,
        { type: "snapshot" },
        input.browserRunId,
      ),
    );
  },
});
