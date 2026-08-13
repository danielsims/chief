import type { AgentSkill } from "./agent-skills.js";
import {
  agentSkillById,
  agentSkillFromPrompt,
  listAgentSkills,
} from "./agent-skills.js";

export type SetupSkill = AgentSkill;

export function setupSkillById(id: string) {
  return agentSkillById("setup", id);
}

export function setupSkillFromPrompt(prompt: string) {
  return agentSkillFromPrompt("setup", prompt);
}

export interface SetupTask {
  id: string;
  domain: string;
  label: string;
  instructions: string;
}

/** Every integration Setup can configure, discovered from its Markdown skills. */
export function setupTaskCatalog(): SetupTask[] {
  return listAgentSkills("setup").flatMap((skill) =>
    skill.domain
      ? [
          {
            id: skill.id,
            domain: skill.domain,
            label: skill.label,
            instructions: skill.instructions,
          },
        ]
      : [],
  );
}
