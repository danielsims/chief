import { z } from "zod";

import { defineAgentTool } from "../../definition.js";

export const snapshotBrowserDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/browser/snapshot",
  operation: {
    operationId: "browser.snapshot",
    summary: "Inspect Chief's visible embedded browser page",
    description:
      "Returns the current URL, title, readable text, and visible semantic controls. Re-inspect after navigation or a material page change.",
  },
  inputSchema: z.object({}),
});
