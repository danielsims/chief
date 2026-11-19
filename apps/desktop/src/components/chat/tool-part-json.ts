import { z } from "zod";

import { jsonValueSchema } from "@chief/relay-contracts";

/**
 * A tool call's input or output as JSON. Local agents send values; hosted
 * agents send them as JSON text, which is read back here. Other text stays
 * text, such as a patch an edit returned.
 */
export const toolPartJsonSchema = z.union([
  z.string().transform((text) => {
    try {
      const parsed = jsonValueSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : text;
    } catch {
      return text;
    }
  }),
  jsonValueSchema,
]);
