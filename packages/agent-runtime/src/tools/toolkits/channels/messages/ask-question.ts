import { z } from "zod";

import { defineAgentTool } from "../../../definition.js";
import { boundedText } from "../../../input.js";

export const askQuestionDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/questions",
  operation: {
    operationId: "questions.ask",
    summary: "Ask the user a multiple-choice question",
    description:
      "Posts a question card with up to six answers in the current conversation. Use it when you need the user to choose before you can continue. End your turn after asking: the user's answer arrives as their next message, and they may reply in their own words instead.",
  },
  inputSchema: z.object({
    question: boundedText(500),
    options: z.array(boundedText(80)).min(2).max(6),
    idempotencyKey: boundedText(120),
  }),
});
