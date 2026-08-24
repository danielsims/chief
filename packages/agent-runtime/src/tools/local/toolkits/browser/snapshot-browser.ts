import { z } from "zod";

import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { browserTargetFields } from "./input.js";

const snapshotBrowserInputSchema = z.object(browserTargetFields);

export const snapshotBrowserTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/browser/snapshot",
  operation: {
    operationId: "browser.snapshot",
    summary: "Inspect Chief's visible embedded browser page",
    description:
      "Returns the current URL, title, readable text, and visible semantic controls. Re-inspect after navigation or a material page change.",
  },
  inputSchema: snapshotBrowserInputSchema,
  async execute({ context, input }) {
    if (!context.browserCommand) {
      throw new Error("The embedded browser is unavailable.");
    }
    return jsonResponse(
      await context.browserCommand(
        input.conversationId,
        { type: "snapshot" },
        input.browserRunId,
      ),
    );
  },
});
