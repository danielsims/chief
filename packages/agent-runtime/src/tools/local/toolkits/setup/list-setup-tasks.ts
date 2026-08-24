import { z } from "zod";

import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const listSetupTasksTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/setup/list",
  operation: {
    operationId: "setup.list",
    summary: "List integration setup tasks",
  },
  inputSchema: z.object({}),
  async execute({ context }) {
    if (!context.listSetupTasks) {
      throw new Error("Setup task discovery is unavailable.");
    }
    return jsonResponse({ available: await context.listSetupTasks() });
  },
});
