import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../input.js";

export const localBrowserContextSchema = z.object({
  conversationId: boundedText(160),
  browserRunId: optionalBoundedText(160),
});
