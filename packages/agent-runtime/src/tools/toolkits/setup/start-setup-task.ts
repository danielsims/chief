import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const startSetupInputSchema = z.object({
  conversationId: optionalBoundedText(160),
  domain: boundedText(255),
});

export const startSetupTaskTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/setup/start",
  operation: {
    operationId: "setup.start",
    summary: "Start an integration setup task",
  },
  inputSchema: startSetupInputSchema,
  async execute({ context, input }) {
    if (!context.startSetup) {
      throw new Error("Agent-driven setup is unavailable.");
    }
    const conversationId = input.conversationId ?? context.conversationId;
    if (!conversationId) {
      throw new Error("conversationId from the runtime context is required.");
    }
    return jsonResponse(await context.startSetup(conversationId, input.domain));
  },
});
