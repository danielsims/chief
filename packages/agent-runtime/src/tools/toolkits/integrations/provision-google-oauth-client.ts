import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const provisionClientInputSchema = z.object({
  sessionId: boundedText(160),
  attemptId: boundedText(160),
});

export const provisionGoogleOAuthClientTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/integrations/google-oauth/provision-client",
  operation: {
    operationId: "googleOAuth.provisionClient",
    summary: "Begin user-owned Google OAuth client setup",
  },
  inputSchema: provisionClientInputSchema,
  async execute({ context, input }) {
    const provisionClient =
      context.integrationSetup?.googleOAuth?.provisionClient;
    if (!provisionClient) {
      throw new Error("Google OAuth client provisioning is unavailable.");
    }
    return jsonResponse(
      await provisionClient(input.sessionId, input.attemptId),
    );
  },
});
