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

/** Normalize a typed domain object into its JSON wire representation. */
export function toJsonObject<Input>(value: Input): JsonObject {
  const result = jsonObjectSchema.safeParse(JSON.parse(JSON.stringify(value)));
  if (!result.success) throw new Error("Value is not a JSON object.");
  return result.data;
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

export function isJsonString<Input>(value: Input): value is Input & string {
  return parseJsonString(value) !== undefined;
}

export function isJsonBoolean<Input>(value: Input): value is Input & boolean {
  return parseJsonBoolean(value) !== undefined;
}

export function isJsonNumber<Input>(value: Input): value is Input & number {
  return parseJsonNumber(value) !== undefined;
}

export function isJsonObject<Input>(value: Input): value is Input & JsonObject {
  return parseJsonObject(value) !== undefined;
}
