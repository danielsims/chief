import { readFile } from "node:fs/promises";
import { parse } from "yaml";

import type { JsonObject } from "@chief/relay-contracts";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

const SKILL_NAME = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const ALLOWED_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

function object(value: unknown): value is JsonObject {
  return isJsonObject(value);
}

function frontmatter(source: string) {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    throw new Error("SKILL.md must start with YAML frontmatter");
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw new Error("SKILL.md frontmatter is not closed");
  const value: unknown = parse(match[1] ?? "");
  if (!object(value)) throw new Error("SKILL.md frontmatter must be a map");
  return value;
}

function optionalString(metadata: JsonObject, field: string, maximum?: number) {
  const value = metadata[field];
  if (value === undefined) return;
  if (!isJsonString(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (maximum && value.length > maximum) {
    throw new Error(`${field} exceeds ${maximum} characters`);
  }
}

export async function validateAgentSkill(path: string, directoryName: string) {
  const metadata = frontmatter(await readFile(path, "utf8"));
  for (const field of Object.keys(metadata)) {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new Error(`unknown frontmatter field ${field}`);
    }
  }
  const name = metadata.name;
  if (!isJsonString(name) || !SKILL_NAME.test(name)) {
    throw new Error("name must use lowercase letters, numbers, and hyphens");
  }
  if (name !== directoryName) {
    throw new Error(`name ${name} must match directory ${directoryName}`);
  }
  const description = metadata.description;
  if (
    !isJsonString(description) ||
    description.length === 0 ||
    description.length > 1024
  ) {
    throw new Error("description must contain 1–1024 characters");
  }
  optionalString(metadata, "license");
  optionalString(metadata, "compatibility", 500);
  optionalString(metadata, "allowed-tools");
  if (metadata.metadata !== undefined) {
    if (
      !object(metadata.metadata) ||
      Object.values(metadata.metadata).some((value) => !isJsonString(value))
    ) {
      throw new Error("metadata must contain string values");
    }
  }
  return { name, description, path };
}
