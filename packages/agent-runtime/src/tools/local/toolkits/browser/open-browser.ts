import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const browserUrlSchema = boundedText(2_000).transform((source, context) => {
  try {
    const url = new URL(source);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // Zod reports the stable boundary error below.
  }
  context.addIssue({
    code: "custom",
    message: "url must be a valid HTTP or HTTPS URL.",
  });
  return z.NEVER;
});

const openBrowserInputSchema = z.object({
  conversationId: boundedText(160),
  url: browserUrlSchema,
  fresh: z.boolean().default(false),
  browserRunId: optionalBoundedText(160),
});

export const openBrowserTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/browser/open",
  operation: {
    operationId: "browser.open",
    summary: "Open or navigate Chief's embedded browser",
    description:
      "Opens inline content at the exact channel or thread position where it was called. It continues this agent execution's current run by default. Pass browserRunId to target another exact run, or fresh=true to create an independent clean run that can coexist with other browsers.",
  },
  inputSchema: openBrowserInputSchema,
  async execute({ context, input }) {
    if (!context.openBrowser) {
      throw new Error("The embedded browser is unavailable.");
    }
    const browserRunId = await context.openBrowser(
      input.conversationId,
      input.url,
      input.fresh,
      input.browserRunId,
    );
    return jsonResponse({
      opened: true,
      fresh: input.fresh,
      url: input.url,
      browserRunId,
    });
  },
});
