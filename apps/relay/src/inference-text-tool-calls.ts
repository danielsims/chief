/**
 * DeepSeek models occasionally emit their native tool-call markup (DSML) as
 * plain text instead of through the tool-calling interface. Posted verbatim,
 * that markup reaches people as gibberish, and the intended tool calls never
 * run. This recovers the calls and removes the markup from the text.
 */
import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import { parseJsonValue } from "@chief/relay-contracts";

// The model writes a full-width bar (U+FF5C); tolerate an ASCII bar too.
const BAR = "[｜|]";
const DSML = `<${BAR}DSML${BAR}`;
const DSML_CLOSE = `</${BAR}DSML${BAR}`;
const blockPattern = new RegExp(
  `${DSML}tool_calls>([\\s\\S]*?)(?:${DSML_CLOSE}tool_calls>|$)`,
  "gu",
);
const invokePattern = new RegExp(
  `${DSML}invoke\\s+name="([^"]+)"\\s*>([\\s\\S]*?)${DSML_CLOSE}invoke>`,
  "gu",
);
const parameterPattern = new RegExp(
  `${DSML}parameter\\s+name="([^"]+)"(?:\\s+string="(true|false)")?\\s*>([\\s\\S]*?)${DSML_CLOSE}parameter>`,
  "gu",
);
const anyMarkup = new RegExp(`${DSML}|${DSML_CLOSE}`, "u");

export interface TextToolCall {
  name: string;
  arguments: JsonObject;
}

export function hasTextToolCallMarkup(text: string) {
  return anyMarkup.test(text);
}

/** Splits text into the calls it encodes and the text left without markup. */
export function extractTextToolCalls(text: string): {
  calls: TextToolCall[];
  text: string;
} {
  const calls: TextToolCall[] = [];
  for (const block of text.matchAll(blockPattern)) {
    for (const invoke of (block[1] ?? "").matchAll(invokePattern)) {
      const name = invoke[1]?.trim();
      if (!name) continue;
      const input: JsonObject = {};
      for (const parameter of (invoke[2] ?? "").matchAll(parameterPattern)) {
        const key = parameter[1];
        if (!key) continue;
        const raw = parameter[3] ?? "";
        input[key] = parameter[2] === "false" ? parseJsonOr(raw) : raw;
      }
      calls.push({ name, arguments: input });
    }
  }
  const remaining = text
    .replace(blockPattern, "")
    .split("\n")
    .filter((line) => !anyMarkup.test(line))
    .join("\n")
    .trim();
  return { calls, text: remaining };
}

function parseJsonOr(raw: string): JsonValue {
  try {
    return parseJsonValue(JSON.parse(raw)) ?? raw;
  } catch {
    return raw;
  }
}
