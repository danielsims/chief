import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const authorizationInputSchema = z.object({
  sessionId: boundedText(160),
  attemptId: boundedText(160),
});

export const authorizeGoogleAnalyticsTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/integrations/google-analytics/authorize",
  operation: {
    operationId: "googleAnalytics.authorize",
    summary: "Start Google Analytics authorization",
  },
  inputSchema: authorizationInputSchema,
  async execute({ context, input }) {
    const analytics = context.integrationSetup?.googleAnalytics;
    if (!analytics) throw new Error("Google Analytics setup is unavailable.");
    return jsonResponse(
      await analytics.startAuthorization(input.sessionId, input.attemptId),
    );
  },
});
