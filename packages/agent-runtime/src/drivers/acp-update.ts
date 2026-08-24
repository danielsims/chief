import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import {
  isJsonNumber,
  isJsonString,
  parseJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

export function toolInput(update: JsonObject, nested: JsonObject) {
  const input: JsonValue | undefined =
    update.input ?? update.rawInput ?? update.arguments ?? nested.input ?? {};
  if (!isJsonString(input)) return input;
  try {
    const parsed: unknown = JSON.parse(input);
    return parseJsonValue(parsed);
  } catch {
    return { value: input };
  }
}

export function toolInputCode(
  update: JsonObject,
  input: JsonValue | undefined,
): string | undefined {
  const inputObject = parseJsonObject(input);
  if (
    input !== undefined &&
    (!inputObject || Object.keys(inputObject).length > 0)
  ) {
    return undefined;
  }
  return isJsonString(update.rawInput) && update.rawInput.trim()
    ? update.rawInput
    : undefined;
}

export function isToolCallUpdate(type: unknown) {
  return (
    type === "tool_call" ||
    type === "tool_call_start" ||
    type === "tool_call_update" ||
    type === "tool_call_end"
  );
}

export function identifier(
  values: (JsonValue | undefined)[],
  fallback: string,
): string {
  const value = values.find(
    (candidate) => isJsonString(candidate) || isJsonNumber(candidate),
  );
  return isJsonString(value) || isJsonNumber(value) ? String(value) : fallback;
}

export function text(values: (JsonValue | undefined)[], fallback: string) {
  return values.find(isJsonString) ?? fallback;
}
