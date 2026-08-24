import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { browserTargetFields } from "./input.js";

const pressBrowserInputSchema = z.object({
  ...browserTargetFields,
  key: boundedText(80),
});

export const pressBrowserTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/browser/press",
  operation: {
    operationId: "browser.press",
    summary: "Press a key in the visible browser",
    description:
      "Presses a key such as Enter or Escape in the shared agent-browser session. Do not traverse controls with repeated Tab or arrow presses when the current snapshot exposes a clickable @ref.",
  },
  inputSchema: pressBrowserInputSchema,
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
