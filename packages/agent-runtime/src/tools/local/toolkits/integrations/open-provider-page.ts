import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const httpsUrlSchema = boundedText(2_000).transform((source, context) => {
  const parsed = z.string().url().safeParse(source);
  if (parsed.success && new URL(parsed.data).protocol === "https:") {
    return parsed.data;
  }
  context.addIssue({
    code: "custom",
    message: "url must be a valid HTTPS URL.",
  });
  return z.NEVER;
});

const openProviderPageInputSchema = z.object({
  sessionId: boundedText(160),
  attemptId: boundedText(160),
  url: httpsUrlSchema,
});

export const openProviderPageTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/integrations/provider/open",
  operation: {
    operationId: "integration.openProviderPage",
    summary: "Open an integration provider page with automatic resume",
    description:
      "Opens a page belonging to the active integration. If provider authentication is required, Chief resumes this same setup agent automatically when the human reaches the requested page.",
  },
  inputSchema: openProviderPageInputSchema,
  async execute({ context, input }) {
    const openProviderPage = context.integrationSetup?.openProviderPage;
    if (!openProviderPage) {
      throw new Error("Provider browser authentication is unavailable.");
    }
    return jsonResponse(
      await openProviderPage(input.sessionId, input.attemptId, input.url),
    );
  },
});
