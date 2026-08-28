import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

const MAX_DETAIL_CHARACTERS = 12_000;
const SENSITIVE_FIELD_PATTERN =
  /(?:authorization|cookie|credential|password|private[-_]?key|secret|session|token|api[-_]?key)/iu;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;

function redactString(value: string): string {
  const withoutBearerTokens = value.replace(
    BEARER_TOKEN_PATTERN,
    "Bearer [redacted]",
  );

  try {
    const url = new URL(withoutBearerTokens);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString();
  } catch {
    return withoutBearerTokens;
  }
}

export function redactActivityValue(
  value: JsonValue,
  fieldName?: string,
): JsonValue {
  if (fieldName && SENSITIVE_FIELD_PATTERN.test(fieldName)) {
    return "[redacted]";
  }
  if (isJsonString(value)) return redactString(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactActivityValue(entry));
  }
  if (isJsonObject(value)) {
    const redacted: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      redacted[key] = redactActivityValue(entry, key);
    }
    return redacted;
  }
  return value;
}

function detailText(value: JsonValue): string {
  if (isJsonString(value)) return redactString(value);
  return JSON.stringify(redactActivityValue(value), null, 2);
}

export function formatActivityValue(value: JsonValue | undefined): string {
  if (value === undefined) return "";
  const text = detailText(value).trim();
  if (text.length <= MAX_DETAIL_CHARACTERS) return text;
  return `${text.slice(0, MAX_DETAIL_CHARACTERS)}\n\n… Output truncated`;
}
