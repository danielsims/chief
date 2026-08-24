import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { browserLabelsSchema, commandLabels } from "./input.js";

const selectBrowserInputSchema = browserLabelsSchema.and(
  z.object({ values: z.array(boundedText(160)).min(1).max(8) }),
);

export const selectBrowserTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/browser/select",
  operation: {
    operationId: "browser.select",
    summary: "Choose an option in a visible browser select field",
    description:
      "Selects one or more values from a native select control using a current agent-browser ref or semantic label. Prefer this over keyboard navigation for select fields.",
  },
  inputSchema: selectBrowserInputSchema,
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
