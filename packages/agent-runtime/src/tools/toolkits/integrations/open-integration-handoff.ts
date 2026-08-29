import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const openIntegrationHandoffInputSchema = z.object({
  sessionId: boundedText(160),
  attemptId: boundedText(160),
  url: boundedText(2_000).pipe(z.string().url()),
});

export const openIntegrationHandoffTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/integrations/handoff/open",
  operation: {
    operationId: "integration.openHandoff",
    summary: "Open a secure local connection handoff",
    description:
      "Opens an Executor connection or OAuth-client handoff in Chief's embedded browser with local authentication added by the trusted host. Use only in a user-started integration setup run.",
  },
  inputSchema: openIntegrationHandoffInputSchema,
  async execute({ context, input }) {
    const openHandoff = context.integrationSetup?.openIntegrationHandoff;
    if (!openHandoff) throw new Error("Integration setup is unavailable.");
    await openHandoff(input.sessionId, input.attemptId, input.url);
    return jsonResponse({ opened: true });
  },
});
