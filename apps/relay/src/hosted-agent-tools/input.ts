import type { JsonObject } from "@chief/relay-contracts";
import {
  agentIdSchema,
  isJsonString,
  parseJsonObject,
} from "@chief/relay-contracts";

export function requiredString(input: JsonObject, key: string) {
  const value = input[key];
  if (!isJsonString(value) || !value.trim()) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

export function stringValue(input: JsonObject, key: string) {
  const value = input[key];
  if (!isJsonString(value)) throw new Error(`${key} must be a string.`);
  return value;
}

export function optionalString(input: JsonObject, key: string) {
  const value = input[key];
  return isJsonString(value) && value.trim() ? value.trim() : undefined;
}

export function stringArray(input: JsonObject, key: string) {
  const value = input[key];
  if (!Array.isArray(value) || !value.every(isJsonString)) {
    throw new Error(`${key} must contain strings.`);
  }
  return value;
}

export function agentIds(input: JsonObject, key: string) {
  return agentIdSchema
    .array()
    .max(20)
    .parse(input[key] ?? []);
}

export function memberReferences(input: JsonObject) {
  if (!Array.isArray(input.members)) throw new Error("members is required.");
  return input.members.map((value) => {
    const member = parseJsonObject(value);
    if (
      !member ||
      (member.type !== "user" && member.type !== "agent") ||
      !isJsonString(member.id)
    ) {
      throw new Error("Each member must contain a valid type and id.");
    }
    return { kind: member.type, principalId: member.id };
  });
}

export function browserTarget(input: JsonObject) {
  const ref = optionalString(input, "ref");
  const labels = input.labels;
  const parsedLabels = Array.isArray(labels)
    ? labels.filter(isJsonString)
    : undefined;
  if (!ref && !parsedLabels?.length) {
    throw new Error("A browser ref or label is required.");
  }
  return {
    ...(ref ? { ref } : undefined),
    ...(parsedLabels?.length ? { labels: parsedLabels } : undefined),
  };
}
