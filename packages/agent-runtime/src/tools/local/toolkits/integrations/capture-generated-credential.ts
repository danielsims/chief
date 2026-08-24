import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const captureGeneratedCredentialInputSchema = z.object({
  sessionId: boundedText(160),
  attemptId: boundedText(160),
});

export const captureGeneratedCredentialTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/integrations/credential/capture",
  operation: {
    operationId: "integration.captureGeneratedCredential",
    summary: "Securely capture a generated provider credential",
    description:
      "Call only while the provider is displaying a newly generated credential in Chief's embedded browser. Chief captures it inside the trusted host and stores it in the prepared Executor connection without returning the value.",
  },
  inputSchema: captureGeneratedCredentialInputSchema,
  async execute({ context, input }) {
    const capture = context.integrationSetup?.captureGeneratedCredential;
    if (!capture) {
      throw new Error("Secure generated-credential capture is unavailable.");
    }
    return jsonResponse(await capture(input.sessionId, input.attemptId));
  },
});
