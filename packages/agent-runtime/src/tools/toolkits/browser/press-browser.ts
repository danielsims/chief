import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";

const pressBrowserInputSchema = z.object({
  key: boundedText(80),
});

export const pressBrowserDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/browser/press",
  operation: {
    operationId: "browser.press",
    summary: "Press a key in the visible browser",
    description:
      "Presses a key such as Enter or Escape in the shared agent-browser session. Do not traverse controls with repeated Tab or arrow presses when the current snapshot exposes a clickable @ref.",
  },
  inputSchema: pressBrowserInputSchema,
});
