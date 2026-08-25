import { defineAgentTool } from "../../definition.js";
import { browserLabelsSchema } from "./input.js";

export const clickBrowserDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/browser/click",
  operation: {
    operationId: "browser.click",
    summary: "Click an agent-browser ref or visible control",
    description:
      "Clicks the first matching current agent-browser snapshot ref or semantic label and returns the refreshed page snapshot. Prefer the exact @ref from the latest snapshot, including for radio-style option cards.",
  },
  inputSchema: browserLabelsSchema,
});
