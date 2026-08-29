import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const selectPropertyInputSchema = z.object({
  sessionId: boundedText(160),
  attemptId: boundedText(160),
  propertyId: boundedText(240),
});

export const selectGoogleAnalyticsPropertyTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/integrations/google-analytics/select",
  operation: {
    operationId: "googleAnalytics.select",
    summary: "Select and verify a Google Analytics property",
  },
  inputSchema: selectPropertyInputSchema,
  async execute({ context, input }) {
    const analytics = context.integrationSetup?.googleAnalytics;
    if (!analytics) throw new Error("Google Analytics setup is unavailable.");
    return jsonResponse(
      await analytics.selectProperty(
        input.sessionId,
        input.attemptId,
        input.propertyId,
      ),
    );
  },
});
