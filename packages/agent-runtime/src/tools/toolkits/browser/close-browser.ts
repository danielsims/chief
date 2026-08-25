import { z } from "zod";

import { defineAgentTool } from "../../definition.js";

export const closeBrowserDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/browser/close",
  operation: {
    operationId: "browser.close",
    summary: "Close Chief's embedded browser",
    description:
      "Ends the current embedded browser run after its work is genuinely finished. Never close a browser after handing it to the user for sign-in, consent, MFA, or another human action.",
  },
  inputSchema: z.object({}),
});
