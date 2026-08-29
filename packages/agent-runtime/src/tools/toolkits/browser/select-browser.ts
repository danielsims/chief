import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";
import { browserLabelsSchema } from "./input.js";

const selectBrowserInputSchema = browserLabelsSchema.and(
  z.object({ values: z.array(boundedText(160)).min(1).max(8) }),
);

export const selectBrowserDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/browser/select",
  operation: {
    operationId: "browser.select",
    summary: "Choose an option in a visible browser select field",
    description:
      "Selects one or more values from a native select control using a current agent-browser ref or semantic label. Prefer this over keyboard navigation for select fields.",
  },
  inputSchema: selectBrowserInputSchema,
});
