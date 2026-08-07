import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface SetupSkillDefinition {
  id: string;
  domain: string;
  label: string;
}

export interface SetupSkill extends SetupSkillDefinition {
  instructions: string;
}

const definitions: SetupSkillDefinition[] = [
  { id: "setup-integration", domain: "", label: "Setup Integration" },
  { id: "setup-github", domain: "github.com", label: "Setup GitHub" },
  { id: "setup-vercel", domain: "vercel.com", label: "Setup Vercel" },
  {
    id: "setup-google-analytics",
    domain: "analytics.googleapis.com",
    label: "Setup Google Analytics",
  },
  {
    id: "setup-gmail",
    domain: "gmail.googleapis.com",
    label: "Setup Gmail",
  },
];

function skillsRoot() {
  const bundledOrSource = fileURLToPath(
    new URL("../setup-skills/", import.meta.url),
  );
  return [
    process.env.CHIEF_SETUP_SKILLS_DIR,
    bundledOrSource,
    join(process.cwd(), "packages/agent-runtime/setup-skills"),
  ]
    .filter((candidate): candidate is string => Boolean(candidate))
    .find((candidate) =>
      existsSync(join(candidate, "setup-github", "SKILL.md")),
    );
}

const root = skillsRoot();

export function setupSkillById(id: string): SetupSkill | undefined {
  const definition = definitions.find((candidate) => candidate.id === id);
  if (!definition || !root) return undefined;
  return {
    ...definition,
    instructions: readFileSync(
      join(root, definition.id, "SKILL.md"),
      "utf8",
    ).trim(),
  };
}

export function setupSkillFromPrompt(prompt: string) {
  const id = /^\[chief-skill:([a-z0-9-]+)]$/im.exec(prompt)?.[1];
  return id ? setupSkillById(id) : undefined;
}

export interface SetupTask {
  id: string;
  domain: string;
  label: string;
  instructions: string;
}

/** Every integration the runtime can set up, with its progressive instructions. */
export function setupTaskCatalog(): SetupTask[] {
  return definitions
    .map((definition) => setupSkillById(definition.id))
    .filter((skill): skill is SetupSkill => Boolean(skill?.domain))
    .map(({ id, domain, label, instructions }) => ({
      id,
      domain,
      label,
      instructions,
    }));
}
