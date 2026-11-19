import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText, optionalBoundedText } from "../../input.js";

/** A draft the person sends themselves, shown as a card they can edit and copy. */
export const showDraftDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/drafts/show",
  operation: {
    operationId: "drafts.show",
    summary: "Show a draft",
    description:
      "Show an email or message you wrote for the person as a card they can edit, copy, or open in their mail app. Use it whenever you draft something they'll send themselves. Nothing is sent. The card holds the text, so reply with one line rather than repeating it.",
  },
  inputSchema: z.object({
    format: z.enum(["email", "message"]),
    to: optionalBoundedText(500),
    subject: optionalBoundedText(300),
    body: boundedText(20_000),
  }),
});
