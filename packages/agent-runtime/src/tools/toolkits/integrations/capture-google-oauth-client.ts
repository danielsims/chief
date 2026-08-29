import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const captureClientInputSchema = z.object({
  sessionId: boundedText(160),
  attemptId: boundedText(160),
});

export const captureGoogleOAuthClientTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/integrations/google-oauth/capture-client",
  operation: {
    operationId: "googleOAuth.captureClient",
    summary: "Securely capture and store a Google OAuth client",
  },
  inputSchema: captureClientInputSchema,
  async execute({ context, input }) {
    const captureClient = context.integrationSetup?.googleOAuth?.captureClient;
    if (!captureClient) {
      throw new Error("Google OAuth credential capture is unavailable.");
    }
    return jsonResponse(await captureClient(input.sessionId, input.attemptId));
  },
});
