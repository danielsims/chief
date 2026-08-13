import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dirent } from "node:fs";

import { agentDefinitionsRoot } from "./agents/loader.js";

const SKILL_MARKER = /\[chief-skill:([a-z0-9]+(?:-[a-z0-9]+)*)]/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AgentSkill {
  id: string;
  name: string;
  label: string;
  description: string;
  domain?: string;
  instructions: string;
  sourcePath: string;
}

function frontmatterValue(source: string, key: string) {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(source)?.[1]?.trim();
  if (!match) return undefined;
  if (
    (match.startsWith('"') && match.endsWith('"')) ||
    (match.startsWith("'") && match.endsWith("'"))
  ) {
    return match.slice(1, -1);
  }
  return match;
}

function skillFile(entry: Dirent, root: string) {
  if (entry.isFile() && entry.name.endsWith(".md")) {
    return join(root, entry.name);
  }
  if (entry.isDirectory()) {
    const candidate = join(root, entry.name, "SKILL.md");
    return existsSync(candidate) ? candidate : undefined;
  }
  return undefined;
}

function humanize(id: string) {
  return id
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** Reads the Markdown skills owned by one filesystem-defined agent. */
export function listAgentSkills(agentId: string): AgentSkill[] {
  if (!SLUG.test(agentId)) return [];
  const root = join(agentDefinitionsRoot(), agentId, "skills");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const sourcePath = skillFile(entry, root);
    if (!sourcePath) return [];
    const instructions = readFileSync(sourcePath, "utf8").trim();
    const fallbackId = entry.isDirectory()
      ? entry.name
      : entry.name.replace(/\.md$/, "");
    const id = frontmatterValue(instructions, "name") ?? fallbackId;
    if (!SLUG.test(id)) return [];
    return [
      {
        id,
        name: id,
        label: frontmatterValue(instructions, "label") ?? humanize(id),
        description: frontmatterValue(instructions, "description") ?? "",
        domain: frontmatterValue(instructions, "domain"),
        instructions,
        sourcePath,
      },
    ];
  });
}

export function agentSkillById(agentId: string, skillId: string) {
  return listAgentSkills(agentId).find((skill) => skill.id === skillId);
}

/** Resolves a compact chat attachment to a skill owned by the mentioned agent. */
export function agentSkillFromPrompt(agentId: string, prompt: string) {
  const id = SKILL_MARKER.exec(prompt)?.[1];
  return id ? agentSkillById(agentId, id) : undefined;
}
