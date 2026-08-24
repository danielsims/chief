import { z } from "zod";

import { relayErrorSchema } from "./envelopes";

export function jsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: "draft-2020-12" });
}

export const errorResponse = {
  description: "The command could not be completed.",
  content: {
    "application/json": {
      schema: jsonSchema(relayErrorSchema),
    },
  },
};

export function pathParameter(name: string) {
  return {
    name,
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1, maxLength: 128 },
  } as const;
}

export function jsonResponse(description: string, schema: z.ZodType) {
  return {
    description,
    content: {
      "application/json": {
        schema: jsonSchema(schema),
      },
    },
  };
}
