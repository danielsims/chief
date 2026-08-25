import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const completeAuthorizationInputSchema = z.object({
  sessionId: boundedText(160),
  attemptId: boundedText(160),
  state: optionalBoundedText(240),
});

export const completeGoogleAnalyticsTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/integrations/google-analytics/complete",
  operation: {
    operationId: "googleAnalytics.complete",
    summary: "Complete and verify Google Analytics authorization",
  },
  inputSchema: completeAuthorizationInputSchema,
  async execute({ context, input }) {
    const analytics = context.integrationSetup?.googleAnalytics;
    if (!analytics) throw new Error("Google Analytics setup is unavailable.");
    return jsonResponse(
      await analytics.completeAuthorization(
        input.sessionId,
        input.attemptId,
        input.state,
      ),
    );
  },
});
