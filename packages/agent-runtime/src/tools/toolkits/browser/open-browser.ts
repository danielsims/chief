import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";

const browserUrlSchema = boundedText(2_000).transform((source, context) => {
  const url = parseUrl(source);
  if (url?.protocol === "http:" || url?.protocol === "https:") {
    return url.toString();
  }
  context.addIssue({
    code: "custom",
    message: "url must be a valid HTTP or HTTPS URL.",
  });
  return z.NEVER;
});

function parseUrl(source: string) {
  try {
    return new URL(source);
  } catch {
    return undefined;
  }
}

export const openBrowserDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/browser/open",
  operation: {
    operationId: "browser.open",
    summary: "Open or navigate Chief's embedded browser",
    description:
      "Opens an HTTP or HTTPS page in the visible agent browser. A server started on this computer is reachable at localhost on its chosen port; port 8080 is reserved for the computer control API. The browser continues its current session by default; use fresh=true only when the task requires a clean session.",
  },
  inputSchema: z.object({
    url: browserUrlSchema,
    fresh: z.boolean().default(false),
  }),
});
