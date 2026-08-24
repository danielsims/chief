import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { browserLabelsSchema, commandLabels } from "./input.js";

const fillBrowserInputSchema = browserLabelsSchema.and(
  z.object({ value: boundedText(2_000) }),
);

export const fillBrowserTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/browser/fill",
  operation: {
    operationId: "browser.fill",
    summary: "Fill a visible browser field by label",
    description:
      "Fills a non-secret visible field in Chief's embedded browser. Never request or fill passwords, passkeys, MFA codes, or account credentials; the user handles authentication directly.",
  },
  inputSchema: fillBrowserInputSchema,
  async execute({ context, input }) {
    if (!context.browserCommand) {
      throw new Error("The embedded browser is unavailable.");
    }
    return jsonResponse(
      await context.browserCommand(
        input.conversationId,
        { type: "fill", labels: commandLabels(input), value: input.value },
        input.browserRunId,
      ),
    );
  },
});
