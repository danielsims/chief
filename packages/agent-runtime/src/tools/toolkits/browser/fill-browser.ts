import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";
import { browserLabelsSchema } from "./input.js";

export const fillBrowserDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/browser/fill",
  operation: {
    operationId: "browser.fill",
    summary: "Fill a visible browser field by label",
    description:
      "Fills a non-secret visible field in Chief's embedded browser. Never request or fill passwords, passkeys, MFA codes, or account credentials; the user handles authentication directly.",
  },
  inputSchema: browserLabelsSchema.and(z.object({ value: boundedText(2_000) })),
});
