import type { JsonObject } from "@chief/relay-contracts";
import { parseJsonObject, parseJsonString } from "@chief/relay-contracts";

export function requiredString(input: JsonObject, key: string) {
  const parsed = parseJsonString(input[key])?.trim();
  if (!parsed) throw new Error(`${key} is required.`);
  return parsed;
}

export function optionalString(input: JsonObject, key: string) {
  const parsed = parseJsonString(input[key])?.trim();
  return parsed === "" ? undefined : parsed;
}

export function requiredStrings(input: JsonObject, key: string) {
  const value = input[key];
  if (!Array.isArray(value)) throw new Error(`${key} is required.`);
  const strings = value.flatMap((item) => {
    const parsed = parseJsonString(item)?.trim();
    return parsed ? [parsed] : [];
  });
  if (strings.length !== value.length) {
    throw new Error(`${key} must contain only strings.`);
  }
  return strings;
}

export function channelMembers(
  input: JsonObject,
): { kind: "user" | "agent"; principalId: string }[] {
  if (!Array.isArray(input.members)) throw new Error("members is required.");
  return input.members.map((value) => {
    const member = parseJsonObject(value);
    const id = member ? parseJsonString(member.id)?.trim() : undefined;
    const kind =
      member?.type === "user"
        ? "user"
        : member?.type === "agent"
          ? "agent"
          : undefined;
    if (!id || !kind) {
      throw new Error("Each member must contain a valid type and id.");
    }
    return { kind, principalId: id };
  });
}
