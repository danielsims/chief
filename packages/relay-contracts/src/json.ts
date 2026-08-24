import { z } from "zod";

/** Values that can cross the relay's JSON wire boundary without coercion. */
export const jsonValueSchema = z.json();

/** A JSON object with string keys and recursively validated JSON values. */
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const jsonScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const jsonBooleanSchema = z.boolean();
const jsonNumberSchema = z.number();
const jsonStringSchema = z.string();

export type JsonValue = z.infer<typeof jsonValueSchema>;
export type JsonObject = z.infer<typeof jsonObjectSchema>;
export function parseJsonValue<Input>(value: Input): JsonValue | undefined {
  const result = jsonValueSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function parseJsonObject<Input>(value: Input): JsonObject | undefined {
  const result = jsonObjectSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function parseJsonScalar<Input>(
  value: Input,
): string | number | boolean | undefined {
  const result = jsonScalarSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function parseJsonString<Input>(value: Input): string | undefined {
  const result = jsonStringSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function parseJsonBoolean<Input>(value: Input): boolean | undefined {
  const result = jsonBooleanSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function parseJsonNumber<Input>(value: Input): number | undefined {
  const result = jsonNumberSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
