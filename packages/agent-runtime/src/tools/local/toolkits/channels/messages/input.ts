import { z } from "zod";

import { optionalBoundedText } from "../../../input.js";

export const messagePagingQuerySchema = z.object({
  cursor: optionalBoundedText(240),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
